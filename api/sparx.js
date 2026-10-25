// api/sparx.js
import axios from 'axios';
import protobuf from 'protobufjs';

// Exact schema derived from binary dumps
const proto = `
syntax = "proto3";

message GetPackageRequest {
  string name = 1;
}

message GetActivityRequest {
  string name = 1;
}

message ActivityActionRequest {
  string activity_id = 1;
  repeated AnswerPart answers = 2;
}

message AnswerPart {
  string part_id = 1;
  repeated Field fields = 2;
}

message Field {
  string field_id = 1;
  string value = 2;
}
`;

const root = protobuf.parse(proto).root;
const GetPackageRequest = root.lookupType('GetPackageRequest');
const GetActivityRequest = root.lookupType('GetActivityRequest');
const ActivityActionRequest = root.lookupType('ActivityActionRequest');
const AnswerPart = root.lookupType('AnswerPart');
const Field = root.lookupType('Field');

export class SparxClient {
    constructor(token, cfClearance) {
        this.api = axios.create({
            baseURL: 'https://api.sparx-learning.com',
            headers: {
                'Content-Type': 'application/grpc-web+proto',
                'X-Grpc-Web': '1',
                'X-User-Agent': 'grpc-web-javascript/0.1',
                'Authorization': `Bearer ${token}`,
                'Cookie': `cf_clearance=${cfClearance}`
            },
            responseType: 'arraybuffer'
        });
    }

    _frame(buf) {
        const h = Buffer.alloc(5);
        h.writeUInt8(0, 0);
        h.writeUInt32BE(buf.length, 1);
        return Buffer.concat([h, buf]);
    }

    _decodeGrpc(buffer) {
        const view = new Uint8Array(buffer);
        let offset = 0;
        const payloads = [];
        while (offset < view.length) {
            if (offset + 5 > view.length) break;
            const flag = view[offset];
            const len = view.readUInt32BE(offset + 1);
            offset += 5;
            if (flag === 0) payloads.push(buffer.slice(offset, offset + len));
            offset += len;
        }
        return payloads.map(p => Buffer.from(p).toString('latin1'));
    }

    _parseTasks(raw) {
        const tasks = [];
        const seen = new Set();
        const resourceRegex = /tasks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\x10/g;
        let match;
        
        let totalXp = 0;
        const xpRegex = /xp\/value\x12[\x00-\xff]([0-9]+)/g;
        let xpMatch;
        while ((xpMatch = xpRegex.exec(raw)) !== null) {
            totalXp += parseInt(xpMatch[1], 10);
        }

        while ((match = resourceRegex.exec(raw)) !== null) {
            const taskId = match[1];
            if (seen.has(taskId)) continue;
            seen.add(taskId);

            const afterIdx = match.index + match[0].length;
            const chunk = raw.substring(afterIdx, afterIdx + 80);

            let name = `Task ${tasks.length + 1}`;
            const nameMatch = chunk.match(/\x1a[\x00-\xff]([\x20-\x7e]+)/);
            if (nameMatch) name = nameMatch[1].trim();

            const isFlashcards = /flashcards|Flashcards/i.test(chunk) || /flashcard/i.test(name);
            const isGame = /\x42\x04game/.test(chunk) || /times table/i.test(name);

            let maxItem = 0;
            const itemRegex = new RegExp(`tasks\\/${taskId}\\/items\\/(\\d+)`, 'g');
            let itemMatch;
            while ((itemMatch = itemRegex.exec(raw)) !== null) {
                maxItem = Math.max(maxItem, parseInt(itemMatch[1], 10));
            }

            tasks.push({
                id: taskId,
                name,
                itemCount: maxItem || 1,
                isSupported: !isFlashcards && !isGame
            });
        }
        
        tasks._totalXp = totalXp; 
        return tasks;
    }

    async getPackage(packageId) {
        const req = GetPackageRequest.create({ name: `packages/${packageId}` });
        const payload = GetPackageRequest.encode(req).finish();
        const framed = this._frame(Buffer.from(payload));

        const res = await this.api.post('/maths/sparx.packageactivity.v1.Packages/GetPackage', framed);
        const frames = this._decodeGrpc(res.data);
        return this._parseTasks(frames.join('\n'));
    }

    async getActivity(packageId, taskId, itemId) {
        const name = `packages/${packageId}/tasks/${taskId}/items/${itemId}`;
        const req = GetActivityRequest.create({ name });
        const payload = GetActivityRequest.encode(req).finish();
        const framed = this._frame(Buffer.from(payload));

        const res = await this.api.post('/maths/sparx.packageactivity.v1.Activities/GetActivity', framed);
        const frames = this._decodeGrpc(res.data);

        for (const text of frames) {
            const start = text.indexOf('[{"layout"');
            if (start !== -1) {
                const end = text.lastIndexOf('}]') + 2;
                const layoutJson = JSON.parse(text.substring(start, end));
                const activityMatch = text.match(/activities\/([0-9a-f-]{36})/);
                return { activityId: activityMatch ? activityMatch[1] : null, layout: layoutJson[0] };
            }
        }
        return null;
    }

    async submitAnswer(activityId, partId, fields) {
        const answerParts = fields.map(f => Field.create({ field_id: f.field_id, value: f.value }));
        const part = AnswerPart.create({ part_id: partId, fields: answerParts });
        const req = ActivityActionRequest.create({ activity_id: `/activities/${activityId}`, answers: [part] });
        
        const framed = this._frame(Buffer.from(ActivityActionRequest.encode(req).finish()));

        try {
            await this.api.post('/maths/sparx.packageactivity.v1.Activities/ActivityAction', framed);
            return true;
        } catch (err) {
            console.error('Submit failed:', err.response?.status);
            return false;
        }
    }
}
