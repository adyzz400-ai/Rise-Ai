const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());
const { solveQuestion } = require('./solver');
const { log } = require('./logger');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fastLoginAndFetch(username, password, schoolName, onProgress) {
    const browser = await chromium.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'] 
    });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
            log('INFO', 'School result not found by selector, pressing Enter');
            await page.keyboard.press('Enter');
        }

        log('INFO', 'Clicking Continue button...');
        try {
            await page.locator('button:has-text("Continue")').first().click({ force: true, timeout: 5000 });
        } catch (e) {
            log('WARN', 'Continue button not found, proceeding anyway');
        }
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
        } else {
            throw new Error('Normal login inputs (.sm-input) not found.');
        }

        if (onProgress) await onProgress(5);
        log('INFO', 'Stage 6: Submitting login');
        await page.locator('.sm-button.login-button').first().click({ force: true });
        await delay(2000);

        if (onProgress) await onProgress(6);
        log('INFO', 'Stage 7: Navigating to homework dashboard');
        await page.goto('https://maths.sparx-learning.com/student/homework', { waitUntil: 'domcontentloaded', timeout: 15000 });
        
        // CRITICAL: Wait longer for the homework cards to actually render
        log('INFO', 'Waiting for homework cards to render...');
        await delay(3000); 

        // Extract assignments with a broader, more robust selector
        const assignments = await page.evaluate(() => {
            // Try multiple possible selectors for Sparx homework cards
            const selectors = [
                '[class*="HomeworkCard"]',
                '[class*="PackageCard"]',
                '.homework-card',
                '[data-testid*="homework"]',
                'a[href*="/student/package/"]' // Fallback to any link going to a package
            ];
            
            let cards = [];
            for (const sel of selectors) {
                cards = document.querySelectorAll(sel);
                if (cards.length > 0) break;
            }

            return Array.from(cards).map((card, i) => {
                const text = card.innerText || card.textContent || '';
                // Clean up the text
                const cleanText = text.replace(/\s+/g, ' ').trim();
                return {
                    id: `pkg_${i}_${Date.now()}`,
                    name: cleanText.split('Due')[0].split('Complete')[0].trim() || `Homework ${i + 1}`,
                    dueText: cleanText.match(/due\s+(.+?)(?:\s+at|\s+by|\.|$)/i)?.[1]?.trim() || 'Unknown',
                    percentComplete: parseInt(cleanText.match(/(\d+)%/)?.[1] || 0)
                };
            }).filter(a => a.name.length > 0); // Filter out empty cards
        });

        log('INFO', `Successfully fetched ${assignments.length} assignments`);
        if (assignments.length === 0) {
            log('WARN', 'Page HTML snippet:', await page.$eval('body', el => el.innerHTML.substring(0, 500)));
        }

        return assignments.length > 0 ? assignments : [{ id: 'default', name: 'Current Homework', dueText: 'Now', percentComplete: 0 }];
        
    } catch (error) {
        log('ERROR', 'Sparx login/fetch error', { error: error.message });
        return null;
    } finally {
        await browser.close();
    }
}

// ... (keep runAutomation the same as before) ...
async function runAutomation(account, waitTime, onProgress) {
    // ... (same as previous version)
}

module.exports = { fastLoginAndFetch, runAutomation };
