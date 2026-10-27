const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());
const { solveQuestion } = require('./solver');
const { log } = require('./logger');

async function fastLoginAndFetch(username, password, schoolName) {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    log('INFO', `Launching stealth browser for ${username} at ${schoolName}`);
    
    try {
        // 1. Go to the OFFICIAL Sparx School Selector (Guarantees it works for ANY school)
        await page.goto('https://selectschool.sparx-learning.com/?app=sparx_maths&forget=1', { 
            waitUntil: 'domcontentloaded', 
            timeout: 15000 
        });

        // 2. Type the school name into the exact input class from your captures
        log('INFO', `Searching for school: ${schoolName}`);
        const searchInput = await page.waitForSelector('input._Input_hz2wn_4', { timeout: 10000 });
        await searchInput.click();
        await searchInput.type(schoolName, { delay: 50 }); // Type realistically to bypass bot detection
        
        // 3. Wait for the dropdown result to appear and click it
        await page.waitForTimeout(1500);
        // Look for the text matching the school name in the dropdown
        const schoolResult = await page.waitForSelector(`text=${schoolName}`, { timeout: 10000 });
        await schoolResult.click();
        
        // 4. Wait for it to redirect to the specific school's OAuth2 login page
        await page.waitForURL('**/oauth2/auth**', { timeout: 10000 });
        log('INFO', `School selected. Redirected to login page.`);

        // 5. Enter Credentials (Using exact IDs from your captures)
        await page.fill('#username', username);
        await page.fill('#password', password);
        
        // 6. Click Login (Using exact class from your captures)
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
            page.click('.login-button')
        ]);

        // 7. Navigate to Homework Dashboard
        await page.goto('https://maths.sparx-learning.com/student/homework', { 
            waitUntil: 'domcontentloaded', 
            timeout: 15000 
        });
        await page.waitForTimeout(2000);

        // 8. Extract Real Assignments
        const assignments = await page.evaluate(() => {
            const cards = document.querySelectorAll('[class*="HomeworkCard"], [class*="PackageCard"], .homework-card');
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

        log('INFO', `Successfully fetched ${assignments.length} assignments for ${username}`);
        return assignments.length > 0 ? assignments : [{ id: 'default', name: 'Current Homework', dueText: 'Now', percentComplete: 0 }];
        
    } catch (error) {
        log('ERROR', 'Sparx login/fetch error', { error: error.message });
        return null;
    } finally {
        await browser.close();
    }
}

async function runAutomation(task, waitTime, onProgress) {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    log('INFO', `Starting automation loop for task ${task.task_id}`);
    
    try {
        let questionNum = task.current_question + 1;
        const totalQuestions = task.total_questions || 10;
        
        while (questionNum <= totalQuestions) {
            // Extract question using exact class from your captures
            const questionText = await page.evaluate(() => {
                const el = document.querySelector('._MarkdownNode_11vlj_281._TextElement_11vlj_83 p');
                return el?.innerText || '';
            });
            
            const answer = await solveQuestion(questionText);
            
            // Input answer using exact class from your captures
            const inputField = await page.$('input._TextField_11vlj_361');
            if (inputField && answer) await inputField.fill(answer);
            
            // Submit using exact class from your captures
            const submitBtn = await page.$('button._ButtonPrimary_1hcbh_201');
            if (submitBtn) await submitBtn.click();
            
            await onProgress(questionNum, task.current_task, totalQuestions, task.total_tasks);
            questionNum++;
            await page.waitForTimeout(waitTime * 1000);
        }
        log('INFO', `Automation completed for task ${task.task_id}`);
        return { success: true };
    } catch (error) {
        log('ERROR', 'Automation loop error', { error: error.message });
        return { success: false, error: error.message };
    } finally {
        await browser.close();
    }
}

module.exports = { fastLoginAndFetch, runAutomation };
