// api/auth.js
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

export async function getSparxSession(username, password, schoolName) {
    const browser = await chromium.launch({
        headless: true,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--no-sandbox',
            '--single-process' // Lowers RAM & CPU footprint for 1GB container
        ]
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();
    page.setDefaultTimeout(120000);

    try {
        await page.goto('https://selectschool.sparx-learning.com/?app=sparx_maths&forget=1', {
            waitUntil: 'domcontentloaded',
            timeout: 90000
        });

        const schoolInput = page.locator('input._Input_hz2wn_4');
        await schoolInput.waitFor({ timeout: 60000 });
        await schoolInput.fill(schoolName);
        await page.waitForTimeout(2000);
        await page.locator('li[role="option"], .school-result').first().click({ timeout: 30000 });

        await page.waitForURL(/oauth2\/auth/, { timeout: 90000 });
        await page.waitForSelector('input[name="username"]', { timeout: 60000 });
        await page.fill('input[name="username"]', username);
        await page.fill('input[name="password"]', password);
        await page.click('button.login-button');

        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120000 });

        const tokenText = await page.evaluate(async () => {
            const res = await fetch('https://api.sparx-learning.com/token');
            return await res.text();
        });
        const bearerToken = tokenText.replace('bearer ', '').trim();
        const cookies = await context.cookies();
        const cfClearance = cookies.find(c => c.name === 'cf_clearance')?.value;

        if (!bearerToken || !cfClearance) throw new Error('Missing credentials.');

        await page.goto('https://maths.sparx-learning.com/student/homework?pkg_type=homework', {
            waitUntil: 'domcontentloaded',
            timeout: 90000
        });
        await page.waitForSelector('a[href*="pkg_id="]', { timeout: 60000 }).catch(() => {});

        const homeworks = await page.evaluate(() => {
            const results = [];
            const links = Array.from(document.querySelectorAll('a[href*="pkg_id="]'));
            const seen = new Set();

            links.forEach(link => {
                try {
                    const url = new URL(link.href, window.location.origin);
                    const pkgId = url.searchParams.get('pkg_id');
                    if (!pkgId || seen.has(pkgId)) return;

                    const text = link.innerText || '';
                    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

                    let name = lines[0] || 'Homework';
                    let dueDate = lines.find(l => l.toLowerCase().includes('due') || l.toLowerCase().includes('yesterday') || l.toLowerCase().includes('today')) || 'Unknown';
                    let accuracy = lines.find(l => l.toLowerCase().includes('accuracy') || l.includes('%')) || 'Unknown';

                    dueDate = dueDate.replace(/^Due:\s*/i, '');
                    accuracy = accuracy.replace(/^Accuracy:\s*/i, '');

                    results.push({ id: pkgId, name, dueDate, accuracy });
                    seen.add(pkgId);
                } catch (e) {}
            });
            return results;
        });

        return { token: bearerToken, cfClearance, homeworks };
    } finally {
        await browser.close();
    }
}
