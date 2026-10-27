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
        if (onProgress) await onProgress(0);
        log('INFO', 'Stage 1: Navigating to school selector');
        await page.goto('https://selectschool.sparx-learning.com/?app=sparx_maths&forget=1', { 
            waitUntil: 'domcontentloaded', 
            timeout: 15000 
        });

        // Stage 2: Search for school
        if (onProgress) await onProgress(1);
        log('INFO', 'Stage 2: Searching for school');
        const searchInput = await page.waitForSelector('input[placeholder*="typing"], input[placeholder*="school"]', { timeout: 10000 });
        await searchInput.click();
        await searchInput.type(schoolName, { delay: 50 });
        
        // Stage 3: Click school result
        if (onProgress) await onProgress(2);
        log('INFO', 'Stage 3: Clicking school result');
        await page.waitForTimeout(1000);
        
        const schoolOption = await page.$(`text=${schoolName}`);
        if (schoolOption) {
            log('INFO', 'Found school result, clicking...');
            await schoolOption.click();
        } else {
            log('INFO', 'School result not found by text, pressing Enter...');
            await page.keyboard.press('Enter');
        }

        // Stage 4: Wait for the login form to appear (MUCH more reliable than waitForURL)
        if (onProgress) await onProgress(3);
        log('INFO', 'Stage 4: Waiting for login form to appear...');
        await page.waitForSelector('#username', { state: 'visible', timeout: 15000 });
        log('INFO', 'Login form detected.');

        // Stage 5: Enter credentials
        if (onProgress) await onProgress(4);
        log('INFO', 'Stage 5: Entering credentials');
        await page.fill('#username', username);
        await page.fill('#password', password);
        
        // Stage 6: Submit login
        if (onProgress) await onProgress(5);
        log('INFO', 'Stage 6: Submitting login');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
            page.click('.login-button').catch(() => {})
        ]);

        // Stage 7: Navigate to homework
        if (onProgress) await onProgress(6);
        log('INFO', 'Stage 7: Navigating to homework dashboard');
        await page.goto('https://maths.sparx-learning.com/student/homework', { 
            waitUntil: 'domcontentloaded', 
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
        const assignments = await fastLoginAndFetch(account.username, account.password, account.school_name, onProgress);
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

            if (onProgress) await onProgress(questionNum, 1, totalQuestions, 1);
            
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
