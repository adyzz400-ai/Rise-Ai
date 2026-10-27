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
        const searchInput = await page.waitForSelector('input[placeholder*="typing"], input[placeholder*="school"]', { timeout: 10000 });
        await searchInput.click();
        await searchInput.type(schoolName, { delay: 50 });
        
        // 3. Click the Result (Wait for the list item to appear)
        await page.waitForTimeout(1000);
        // Look for the specific school name in the dropdown results
        const schoolResult = page.locator('div[class*="school"], li, [role="option"]').filter({ hasText: schoolName }).first();
        await schoolResult.click({ timeout: 5000 });
        
        // 4. WAIT FOR LOGIN FORM (Instead of specific URL)
        // This is much more reliable. If we see the username box, we are on the login page.
        log('INFO', 'Waiting for login form...');
        await page.waitForSelector('input[name="username"], #username', { timeout: 15000 });
        log('INFO', 'Login form found.');

        // 5. Enter Credentials
        await page.fill('input[name="username"], #username', username);
        await page.fill('input[name="password"], #password', password);
        
        // 6. Click Login
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
            page.click('button[type="submit"], .login-button')
        ]);

        // 7. Fetch Homework
        await page.goto('https://maths.sparx-learning.com/student/homework', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

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

// REAL AUTOMATION LOOP
async function runAutomation(account, waitTime, onProgress) {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    
    try {
        // 1. Login first
        const assignments = await fastLoginAndFetch(account.username, account.password, account.school_name);
        if (!assignments) throw new Error('Login failed');

        // 2. Navigate to the first task (Simplified for now)
        // In a full version, you'd use the assignmentId passed in.
        // For now, we click the first homework card
        await page.goto('https://maths.sparx-learning.com/student/homework', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1000);
        
        const firstTask = await page.$('[class*="HomeworkCard"], [class*="PackageCard"]');
        if (firstTask) await firstTask.click();
        await page.waitForTimeout(2000);

        // 3. Solve Loop
        let questionNum = 1;
        const totalQuestions = 9; // Default
        
        while (questionNum <= totalQuestions) {
            log('INFO', `Solving question ${questionNum}...`);
            
            // Extract Question
            const questionText = await page.evaluate(() => {
                // Broad selector to catch the question text
                const el = document.querySelector('p, div[class*="Text"], span[class*="Question"]');
                return el ? el.innerText : 'Unknown Question';
            });

            // Solve
            const answer = await solveQuestion(questionText);
            log('INFO', `Answer: ${answer}`);

            // Submit (Simplified)
            const input = await page.$('input[type="text"], input[type="number"]');
            if (input) await input.fill(answer || '0');
            
            const submitBtn = await page.$('button[class*="Submit"], button:has-text("Check")');
            if (submitBtn) await submitBtn.click();

            // Update Discord
            await onProgress(questionNum, 1, totalQuestions, 1);
            
            questionNum++;
            await page.waitForTimeout(waitTime * 1000);
            
            // Break if we hit a "Task Complete" screen
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
