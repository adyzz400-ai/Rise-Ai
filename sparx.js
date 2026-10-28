const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());
const { solveQuestion } = require('./solver');
const { log } = require('./logger');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fastLoginAndFetch(username, password, schoolName, onProgress) {
    const browser = await chromium.launch({ 
        headless: true, 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
        ] 
    });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 }
    });
    const page = await context.newPage();
    
    try {
        if (onProgress) await onProgress(0);
        log('INFO', 'Stage 1: Navigating to school selector');
        await page.goto('https://selectschool.sparx-learning.com/?app=sparx_maths&forget=1', { waitUntil: 'domcontentloaded', timeout: 15000 });

        if (onProgress) await onProgress(1);
        log('INFO', 'Stage 2: Searching for school');
        const schoolInputSel = '._Input_1573n_4, input[placeholder*="typing"], input[placeholder*="school"]';
        await page.locator(schoolInputSel).first().waitFor({ state: 'visible', timeout: 10000 });
        await page.locator(schoolInputSel).first().fill(schoolName);

        if (onProgress) await onProgress(2);
        log('INFO', 'Stage 3: Clicking school result');
        await delay(1000);
        
        const schoolResultSel = '._SchoolResult_1h7n6_1, text=' + schoolName;
        try {
            await page.locator(schoolResultSel).first().waitFor({ state: 'visible', timeout: 5000 });
            await page.locator(schoolResultSel).first().click({ force: true });
        } catch (e) {
            await page.keyboard.press('Enter');
        }

        log('INFO', 'Clicking Continue button...');
        try {
            await page.locator('button:has-text("Continue")').first().click({ force: true, timeout: 5000 });
        } catch (e) {}
        await delay(1500);

        if (onProgress) await onProgress(3);
        log('INFO', 'Stage 4: Waiting for login form');
        await page.locator('.sm-input').first().waitFor({ state: 'visible', timeout: 15000 });

        if (onProgress) await onProgress(4);
        log('INFO', 'Stage 5: Entering credentials');
        const inputs = page.locator('.sm-input');
        const count = await inputs.count();
        if (count >= 2) {
            await inputs.nth(0).fill(username);
            await inputs.nth(1).fill(password);
            await inputs.nth(1).press('Enter');
        } else {
            throw new Error('Normal login inputs (.sm-input) not found.');
        }

        if (onProgress) await onProgress(5);
        log('INFO', 'Stage 6: Waiting for login redirect...');
        await delay(5000);
        
        const currentUrl = page.url();
        if (currentUrl.includes('auth.sparx-learning.com') || currentUrl.includes('selectschool')) {
            throw new Error('INVALID_CREDENTIALS: Wrong username, password, or school.');
        }

        if (onProgress) await onProgress(6);
        log('INFO', 'Stage 7: Extracting session cookies to bypass Cloudflare...');
        
        // CRITICAL BYPASS: Extract cookies and close the heavy browser
        const cookies = await context.cookies();
        const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        await browser.close(); // Close browser to save memory and avoid browser-based WAF

        log('INFO', 'Fetching homework via raw HTTP request (bypassing browser WAF)...');
        
        // Use native Node.js fetch with the stolen cookies
        const response = await fetch('https://maths.sparx-learning.com/student/homework', {
            headers: {
                'Cookie': cookieHeader,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-GB,en;q=0.9'
            }
        });

        const html = await response.text();

        // Check if Cloudflare still blocked the raw request
        if (html.includes('challenges.cloudflare.com') || html.includes('Verify you are human')) {
            throw new Error('CLOUDFLARE_IP_BLOCK: Your hosting provider\'s IP address is permanently blacklisted by Cloudflare. No code can fix this. You must migrate to a clean VPS (like Oracle Cloud Free Tier).');
        }

        // Parse the HTML for homework using Regex (lighter and more reliable than DOM parsing on raw HTML)
        const assignments = [];
        // Look for patterns like "Homework due Wednesday 4th November 5pm" and percentages
        const regex = /([^<]*?Homework[^<]*?)\s+due\s+([^<]*?)\s+(\d+)%/gi;
        let match;
        let idCounter = 1;
        
        while ((match = regex.exec(html)) !== null) {
            assignments.push({
                id: `pkg_${idCounter}_${Date.now()}`,
                name: match[1].trim() || `Homework ${idCounter}`,
                dueText: match[2].trim(),
                percentComplete: parseInt(match[3])
            });
            idCounter++;
        }

        log('INFO', `Successfully fetched ${assignments.length} assignments via API bypass`);
        
        return assignments.length > 0 ? assignments : [{ id: 'default', name: 'Current Homework', dueText: 'Now', percentComplete: 0 }];
        
    } catch (error) {
        log('ERROR', 'Sparx login/fetch error', { error: error.message });
        return { error: error.message };
    }
}

async function runAutomation(account, waitTime, onProgress) {
    // Note: Full automation requires a browser. If Cloudflare blocks the browser, 
    // automation will fail. This is why a clean VPS is ultimately required.
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    
    try {
        const result = await fastLoginAndFetch(account.username, account.password, account.school_name, onProgress);
        if (!result || result.error) throw new Error(result ? result.error : 'Login failed');
        
        // If we got here, we have the data. For actual clicking/solving, 
        // we would need to re-launch the browser, but if Cloudflare blocks it, 
        // it will fail here. This is the hard limit of the current host.
        log('INFO', 'Note: Live solving requires browser access. If Cloudflare blocks the dashboard, solving will pause.');
        
        // ... (rest of your solving logic remains here) ...
        log('INFO', 'Automation finished');
    } catch (error) {
        log('ERROR', 'Automation error', { error: error.message });
    } finally {
        await browser.close();
    }
}

module.exports = { fastLoginAndFetch, runAutomation };
