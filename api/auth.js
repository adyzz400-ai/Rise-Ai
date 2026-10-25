// api/auth.js
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

export async function getSparxSession(username, password, schoolName, onProgress = () => {}) {
    // Headed mode + persistent context saves the cf_clearance cookie, so you only solve once.
    const browser = await chromium.launchPersistentContext('./sparx-profile', {
        headless: false,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--no-sandbox',
            '--window-size=1280,800'
        ]
    });

    const page = browser.pages()[0] || await browser.newPage();
    page.setDefaultTimeout(120000);

    try {
        onProgress('Navigating to school selector...');
        await page.goto('https://selectschool.sparx-learning.com/?app=sparx_maths&forget=1', {
            waitUntil: 'commit',
            timeout: 90000
        });

        onProgress('Waiting for school search input...');
        const schoolInput = page.locator('input._Input_hz2wn_4');
        await schoolInput.waitFor({ state: 'attached', timeout: 60000 });
        
        onProgress(`Typing school: ${schoolName}...`);
        await schoolInput.click();
        await schoolInput.fill('');
        await schoolInput.pressSequentially(schoolName, { delay: 100 });
        await page.waitForTimeout(3000);

        onProgress('Selecting school...');
        await schoolInput.press('Enter');
        await page.waitForTimeout(2000);

        // Fallback: click the text option if Enter fails
        if (page.url().includes('selectschool')) {
            const textOption = page.locator(`text="${schoolName}"`).first();
            if (await textOption.isVisible().catch(() => false)) {
                await textOption.click({ timeout: 15000, force: true });
            }
        }

        onProgress('Waiting for login form...');
        await page.waitForSelector('input[name="username"]', { timeout: 60000 });

        onProgress('Entering credentials...');
        await page.fill('input[name="username"]', username);
        await page.fill('input[name="password"]', password);
        await page.click('button.login-button');

        onProgress('Solving Cloudflare / logging in...');
        
        // POLLING LOOP: Do not wait for navigation. Poll for the token or dashboard URL.
        let bearerToken = null;
        let cfClearance = null;
        const startTime = Date.now();
        const timeoutMs = 120000; // 2 minutes max for Cloudflare

        while (Date.now() - startTime < timeoutMs) {
            const currentUrl = page.url();
            const isDashboard = currentUrl.includes('/student/homework') || currentUrl.includes('/student');

            // Try to fetch the token via in-page fetch
            const tokenText = await page.evaluate(async () => {
                try {
                    const res = await fetch('https://api.sparx-learning.com/token');
                    return await res.text();
                } catch (e) {
                    return null;
                }
            }).catch(() => null);

            if (tokenText && tokenText.includes('bearer')) {
                bearerToken = tokenText.replace('bearer ', '').trim();
                const cookies = await browser.cookies();
                cfClearance = cookies.find(c => c.name === 'cf_clearance')?.value;
                if (bearerToken && cfClearance) {
                    onProgress('Token extracted. Cloudflare cleared.');
                    break;
                }
            }

            // If we have the token but the URL isn't the dashboard yet, navigate directly.
            if (bearerToken && !isDashboard) {
                onProgress('Navigating to homework dashboard...');
                await page.goto('https://maths.sparx-learning.com/student/homework?pkg_type=homework', {
                    waitUntil: 'commit',
                    timeout: 90000
                });
                await page.waitForTimeout(5000); // Give React time to render
            }

            await page.waitForTimeout(3000);
            onProgress(`Waiting for Cloudflare... (${Math.floor((Date.now() - startTime) / 1000)}s)`);
        }

        if (!bearerToken || !cfClearance) {
            throw new Error('Cloudflare challenge did not clear. Try restarting the bot or using a residential proxy.');
        }

        onProgress('Scraping homework dashboard...');
        // Ensure we are on the dashboard before scraping
        if (!page.url().includes('/student/homework')) {
            await page.goto('https://maths.sparx-learning.com/student/homework?pkg_type=homework', {
                waitUntil: 'commit',
                timeout: 90000
            });
        }
        // Wait for the homework links to appear
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
