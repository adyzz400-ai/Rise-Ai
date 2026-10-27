const { log } = require('./logger');
const schoolCache = new Map();
schoolCache.set('heston community school', '73c19cc9-1158-40ce-a858-b6f2061af7d8');

async function getSchoolId(schoolName) {
    if (schoolCache.has(schoolName.toLowerCase())) return schoolCache.get(schoolName.toLowerCase());
    try {
        log('INFO', `Looking up school ID for: ${schoolName}`);
        const response = await fetch(`https://selectschool.sparx-learning.com/api/schools/search?q=${encodeURIComponent(schoolName)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        if (!response.ok) throw new Error('School search failed');
        const schools = await response.json();
        const match = schools.find(s => s.name.toLowerCase().includes(schoolName.toLowerCase()));
        if (match && match.id) {
            schoolCache.set(schoolName.toLowerCase(), match.id);
            return match.id;
        }
        return null;
    } catch (error) {
        log('ERROR', 'School lookup failed', { error: error.message });
        return null;
    }
}

module.exports = { getSchoolId };
