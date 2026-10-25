// api/auth.js
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

export async function getSparxSession(username, password, schoolName, onProgress = () => {}) {
    const browser = await chromium.launch({
        headless: true,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--no-sandbox',
            '--disable-accelerated-2d-canvas'
        ]
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();
    page.setDefaultTimeout(120000);

    try {
        onProgress('Navigating to school selector...');
        await page.goto('https://selectschool.sparx-learning.com/?app=sparx_maths&forget=1', {
            waitUntil: 'commit', // Do not wait for load/domcontentloaded
            timeout: 90000
        });

        onProgress('Waiting for school search input...');
        const schoolInput = page.locator('input._Input_hz2wn_4');
        await schoolInput.waitFor({ state: 'attached', timeout: 60000 });
        
        onProgress(`Typing school name: ${schoolName}...`);
        await schoolInput.click();
        await schoolInput.fill('');
        await schoolInput.pressSequentially(schoolName, { delay: 100 });
        await page.waitForTimeout(3000); // Grace period for React/API

        onProgress('Selecting school...');
        await schoolInput.press('Enter');
        await page.waitForTimeout(2000);

        // Fallback: click text if Enter failed
        if (page.url().includes('selectschool')) {
            const textOption = page.locator(`text="${schoolName}"`).first();
            if (await textOption.isVisible().catch(() => false)) {
                await textOption.click({ timeout: 15000, force: true });
            }
        }

        onProgress('Waiting for login page...');
        await page.waitForURL(/oauth2\/auth/, { timeout: 90000, waitUntil: 'commit' });
        await page.waitForSelector('input[name="username"]', { timeout: 60000 });

        onProgress('Entering credentials...');
        await page.fill('input[name="username"]', username);
        await page.fill('input[name="password"]', password);
        await page.click('button.login-button');

        onProgress('Solving Cloudflare challenge / logging in...');
        await page.waitForNavigation({ waitUntil: 'commit', timeout: 120000 });
        await page.waitForTimeout(5000); // Grace period for cf_clearance

        onProgress('Extracting Bearer token...');
        const tokenText = await page.evaluate(async () => {
            const res = await fetch('https://api.sparx-learning.com/token');
            return await res.text();
        });
        const bearerToken = tokenText.replace('bearer ', '').trim();
        const cookies = await context.cookies();
        const cfClearance = cookies.find(c => c.name === 'cf_clearance')?.value;

        if (!bearerToken || !cfClearance) throw new Error('Missing credentials.');

        onProgress('Scraping homework dashboard...');
        await page.goto('https://maths.sparx-learning.com/student/homework?pkg_type=homework', {
            waitUntil: 'commit',
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

        onProgress('Login complete.');
        return { token: bearerToken, cfClearance, homeworks };
    } finally {
        await browser.close();
    }
}
