const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());
const { solveQuestion } = require('./solver');
const { log } = require('./logger');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fastLoginAndFetch(username, password, schoolName, onProgress) {
    // Use ChurroAI's exact launch arguments for maximum stealth
    const browser = await chromium.launch({ 
        headless: true, 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--ignore-certificate-errors',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
            '--ignore-certificate-errors-spki-list'
        ] 
    });
    
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        ignoreHTTPSErrors: true
    });
    
    const page = await context.newPage();

    // CRITICAL: Inject ChurroAI's stealth script to bypass Cloudflare detection
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        window.chrome = { runtime: {} };
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
                Promise.resolve({ state: Notification.permission }) :
                originalQuery(parameters)
        );
        Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    });
    
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
            log('INFO', 'School result not found by selector, pressing Enter to select first match');
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
            log('INFO', 'Filled username/email');
            await inputs.nth(1).fill(password);
            log('INFO', 'Filled password');
            
            await inputs.nth(1).press('Enter');
            log('INFO', 'Pressed Enter to submit form');
        } else {
            throw new Error('Normal login inputs (.sm-input) not found.');
        }

        if (onProgress) await onProgress(5);
        log('INFO', 'Stage 6: Waiting for login redirect...');
        
        await delay(5000);
        const currentUrl = page.url();
        log('INFO', `Current URL after login attempt: ${currentUrl}`);

        if (currentUrl.includes('auth.sparx-learning.com') || currentUrl.includes('selectschool')) {
            const errorText = await page.$eval('.sm-error, .error-message, [class*="error"], [class*="alert"]', el => el.innerText).catch(() => 'No specific error message found');
            throw new Error(`INVALID_CREDENTIALS: ${errorText}`);
        }

        if (onProgress) await onProgress(6);
        log('INFO', 'Stage 7: Navigating to homework dashboard');
        
        // Use domcontentloaded instead of networkidle to avoid Cloudflare hanging the request
        try {
            await page.goto('https://maths.sparx-learning.com/student/homework', { waitUntil: 'domcontentloaded', timeout: 15000 });
        } catch (navError) {
            log('WARN', 'Navigation had issues, waiting for load state anyway...', { error: navError.message });
            await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        }
        
        log('INFO', 'Waiting for homework dashboard to fully render...');
        await delay(5000); // Give React time to render after domcontentloaded

        // Check if we are stuck on a Cloudflare challenge
        const pageText = await page.$eval('body', el => el.innerText).catch(() => '');
        if (pageText.includes('challenges.cloudflare.com') || pageText.includes('Verify you are human')) {
            throw new Error('CLOUDFLARE_BLOCKED: The hosting IP is being blocked by Cloudflare. Please try again later or use a different hosting provider.');
        }

        const assignments = await page.evaluate(() => {
            const allElements = Array.from(document.querySelectorAll('*'));
            const homeworkElements = allElements.filter(el => {
                const text = el.innerText.toLowerCase();
                return text.includes('homework') && text.includes('due') && el.children.length < 15; 
            });

            const uniqueCards = [];
            for (const el of homeworkElements) {
                if (!uniqueCards.some(c => c.contains(el) && c !== el)) {
                    uniqueCards.push(el);
                }
            }

            return uniqueCards.slice(0, 10).map((card, i) => {
                const text = card.innerText.replace(/\s+/g, ' ').trim();
                return {
                    id: `pkg_${i}_${Date.now()}`,
                    name: text.split(/due/i)[0].trim() || `Homework ${i + 1}`,
                    dueText: text.match(/due\s+(.+?)(?:\s+at|\s+by|\.|$)/i)?.[1]?.trim() || 'Unknown',
                    percentComplete: parseInt(text.match(/(\d+)%/)?.[1] || 0)
                };
            });
        });

        log('INFO', `Successfully fetched ${assignments.length} assignments`);
        if (assignments.length === 0) {
            log('WARN', 'Page visible text:', await page.$eval('body', el => el.innerText.substring(0, 300)));
        }

        return assignments.length > 0 ? assignments : [{ id: 'default', name: 'Current Homework', dueText: 'Now', percentComplete: 0 }];
        
    } catch (error) {
        log('ERROR', 'Sparx login/fetch error', { error: error.message });
        return { error: error.message };
    } finally {
        await browser.close();
    }
}

async function runAutomation(account, waitTime, onProgress) {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    
    try {
        const result = await fastLoginAndFetch(account.username, account.password, account.school_name, onProgress);
        if (!result || result.error) throw new Error(result ? result.error : 'Login failed');
        const assignments = result;

        await page.goto('https://maths.sparx-learning.com/student/homework', { waitUntil: 'domcontentloaded' }).catch(() => {});
        await delay(1000);
        
        const firstTask = await page.$('text="Homework"');
        if (firstTask) {
            const card = await firstTask.evaluateHandle(el => {
                let parent = el.parentElement;
                while (parent && parent.children.length > 15) {
                    parent = parent.parentElement;
                }
                return parent || el;
            });
            await card.click();
        }
        await delay(2000);

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
            await delay(waitTime * 1000);
            
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
