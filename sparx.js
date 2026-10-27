const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());
const { solveQuestion } = require('./solver');
const { log } = require('./logger');

async function fastLoginAndFetch(username, password, schoolName) {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    log('INFO', `Launching stealth browser for ${username}`);
    
    try {
        // 1. Go to School Selector
        await page.goto('https://selectschool.sparx-learning.com/?app=sparx_maths&forget=1', { waitUntil: 'domcontentloaded', timeout: 15000 });

        // 2. Type School Name
        log('INFO', `Searching for school: ${schoolName}`);
        const searchInput = await page.waitForSelector('input[placeholder*="typing"], input[placeholder*="school"], input[type="text"]', { timeout: 10000 });
        await searchInput.click();
        await searchInput.type(schoolName, { delay: 50 });
        
        // 3. Click the Result
        log('INFO', 'Waiting for school dropdown results...');
        await page.waitForTimeout(1500);
        
        const selectors = [
            `button:has-text("${schoolName}")`,
            `a:has-text("${schoolName}")`,
            `div:has-text("${schoolName}")`,
            `li:has-text("${schoolName}")`
        ];
        
        let clicked = false;
        for (const selector of selectors) {
            try {
                const element = await page.$(selector);
                if (element) {
                    await element.click();
                    log('INFO', `Clicked school result.`);
                    clicked = true;
                    break;
                }
            } catch (e) { /* Try next */ }
        }
        if (!clicked) await page.keyboard.press('Enter');
        
        // 4. CRITICAL FIX: Wait for the actual Login Page to load
        // We wait for the specific login container class found in your devtool captures
        log('INFO', 'Waiting for login page to load...');
        await page.waitForSelector('.um-login-box, #login-form', { timeout: 15000 });
        log('INFO', 'Login page loaded. Finding inputs...');

        // 5. Enter Credentials
        await page.waitForSelector('#username, input[name="username"]', { timeout: 5000 });
        await page.fill('#username, input[name="username"]', username);
        await page.fill('#password, input[name="password"]', password);
        
        // 6. Click Login
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
            page.click('button[type="submit"], .login-button').catch(() => {})
        ]);

        // 7. Navigate to Homework
        log('INFO', 'Navigating to homework dashboard...');
        await page.goto('https://maths.sparx-learning.com/student/homework', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        // 8. Extract Assignments
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

        log('INFO', `Fetched ${assignments.length} assignments`);
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

        await page.goto('https://maths.sparx-learning.com/student/homework', { waitUntil: 'domcontentloaded' });
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
