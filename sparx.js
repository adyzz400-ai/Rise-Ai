const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());
const { solveQuestion } = require('./solver');
const { log } = require('./logger');

async function fastLoginAndFetch(username, password, schoolName, onProgress) {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    
    try {
        // Stage 1: Navigate to school selector
        log('INFO', 'Stage 1: Navigating to school selector');
        if (onProgress) await onProgress(0);
        
        await page.goto('https://selectschool.sparx-learning.com/?app=sparx_maths&forget=1', { 
            waitUntil: 'networkidle', 
            timeout: 20000 
        });

        // Stage 2: Search for school
        log('INFO', 'Stage 2: Searching for school');
        if (onProgress) await onProgress(1);
        
        const searchInput = await page.waitForSelector('input[placeholder*="typing"], input[placeholder*="school"], input[type="text"]', { timeout: 10000 });
        await searchInput.click();
        await searchInput.type(schoolName, { delay: 50 });
        
        // Stage 3: Click school result and wait for redirect
        log('INFO', 'Stage 3: Clicking school result');
        if (onProgress) await onProgress(2);
        
        await page.waitForTimeout(1500);
        
        // Try multiple selectors to find and click the school
        const selectors = [
            `button:has-text("${schoolName}")`,
            `a:has-text("${schoolName}")`,
            `div:has-text("${schoolName}")`,
            `li:has-text("${schoolName}")`
        ];
        
        let clicked = false;
        for (const selector of selectors) {
            try {
                const el = await page.$(selector);
                if (el) {
                    log('INFO', `Clicking school using selector: ${selector}`);
                    // CRITICAL: Wait for navigation when clicking the school
                    await Promise.all([
                        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }),
                        el.click()
                    ]);
                    clicked = true;
                    log('INFO', 'School clicked, navigation completed');
                    break;
                }
            } catch (e) {
                // Try next selector
            }
        }
        
        if (!clicked) {
            log('INFO', 'No selector found, pressing Enter');
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
                page.keyboard.press('Enter')
            ]);
        }

        // Stage 4: Wait for login form to appear
        log('INFO', 'Stage 4: Waiting for login form');
        if (onProgress) await onProgress(3);
        
        // From your HTML captures, the login form has these exact elements
        await page.waitForSelector('#username, input[name="username"]', { timeout: 15000 });
        log('INFO', 'Login form found');

        // Stage 5: Enter credentials
        log('INFO', 'Stage 5: Entering credentials');
        if (onProgress) await onProgress(4);
        
        await page.fill('#username, input[name="username"]', username);
        await page.fill('#password, input[name="password"]', password);
        
        // Stage 6: Submit login
        log('INFO', 'Stage 6: Submitting login');
        if (onProgress) await onProgress(5);
        
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
            page.click('button[type="submit"], .login-button').catch(() => {})
        ]);

        // Stage 7: Navigate to homework and fetch
        log('INFO', 'Stage 7: Fetching homework');
        if (onProgress) await onProgress(6);
        
        await page.goto('https://maths.sparx-learning.com/student/homework', { 
            waitUntil: 'networkidle', 
            timeout: 15000 
        });
        await page.waitForTimeout(2000);

        // Extract assignments
        const assignments = await page.evaluate(() => {
            const cards = document.querySelectorAll('[class*="HomeworkCard"], [class*="PackageCard"]');
            return Array.from(cards).map((card, i) => {
                const text = card.innerText || '';
                return {
                    id: `pkg_${i}_${Date.now()}`,
                    name: text.split('\n')[0] || `Homework ${i + 1}`,
                    dueText: text.match(/due\s+(.+?)(?:\s+at|\s+by|\.)/i)?.[1] || 'Unknown',
                    percentComplete: parseInt(text.match(/(\d+)%/)?.[1] || 0)
                };
            });
        });

        log('INFO', `Successfully fetched ${assignments.length} assignments`);
        return assignments.length > 0 ? assignments : [{ id: 'default', name: 'Current Homework', dueText: 'Now', percentComplete: 0 }];
        
    } catch (error) {
        log('ERROR', 'Sparx login/fetch error', { error: error.message });
        return null;
    } finally {
        await browser.close();
    }
}

async function runAutomation(account, waitTime, onProgress) {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    
    try {
        const assignments = await fastLoginAndFetch(account.username, account.password, account.school_name);
        if (!assignments) throw new Error('Login failed');

        await page.goto('https://maths.sparx-learning.com/student/homework', { waitUntil: 'networkidle' });
        await page.waitForTimeout(1000);
        
        const firstTask = await page.$('[class*="HomeworkCard"], [class*="PackageCard"]');
        if (firstTask) await firstTask.click();
        await page.waitForTimeout(2000);

        let questionNum = 1;
        const totalQuestions = 9;
        
        while (questionNum <= totalQuestions) {
            log('INFO', `Solving question ${questionNum}...`);
            
            const questionText = await page.evaluate(() => {
                const el = document.querySelector('p, div[class*="Text"], span[class*="Question"]');
                return el ? el.innerText : 'Unknown Question';
            });

            const answer = await solveQuestion(questionText);
            log('INFO', `Answer: ${answer}`);

            const input = await page.$('input[type="text"], input[type="number"]');
            if (input) await input.fill(answer || '0');
            
            const submitBtn = await page.$('button[class*="Submit"], button:has-text("Check")');
            if (submitBtn) await submitBtn.click();

            await onProgress(questionNum, 1, totalQuestions, 1);
            
            questionNum++;
            await page.waitForTimeout(waitTime * 1000);
            
            const isComplete = await page.$('text=Task Complete');
            if (isComplete) break;
        }
        log('INFO', 'Automation finished');
    } catch (error) {
        log('ERROR', 'Automation error', { error: error.message });
    } finally {
        await browser.close();
    }
}

module.exports = { fastLoginAndFetch, runAutomation };
