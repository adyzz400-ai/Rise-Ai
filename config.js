require('dotenv').config();

module.exports = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    STATUS_CHANNEL_ID: process.env.STATUS_CHANNEL_ID,
    
    TIMING_MODES: {
        adaptive: { label: 'Adaptive (Recommended)', desc: '30-60s reading, 15s to answer', seconds: 45 },
        cautious: { label: 'Cautious', desc: 'About 1 hour in total', seconds: 60 },
        fast: { label: 'Fast', desc: 'About 40s per question - use at risk', seconds: 40 },
        inhumane: { label: 'Inhumane', desc: 'No answer delay - detention worthy', seconds: 5 },
        custom: { label: 'Custom', desc: 'Use the seconds below', seconds: 40 }
    },
    
    PLATFORMS: [
        { label: 'Sparx Maths · Normal', value: 'sparx_normal' },
        { label: 'Sparx Maths · Microsoft', value: 'sparx_microsoft' },
        { label: 'Sparx Maths · Google', value: 'sparx_google' }
    ],
    
    FUN_FACTS: [
        "The letter E is the most frequently used letter in many English texts.",
        "A solar eclipse happens when the Moon passes between Earth and the Sun.",
        "Honey never spoils - archaeologists found 3000-year-old honey in Egyptian tombs.",
        "Octopuses have three hearts and blue blood.",
        "The blue whale is the largest known animal.",
        "Scotland has 421 words for 'snow'.",
        "The unicorn is Scotland's national animal.",
        "Bananas are berries, but strawberries aren't.",
        "Zero is the only number that cannot be represented in Roman numerals.",
        "The shortest war in history lasted 38 minutes."
    ],
    
    // 7 Stages for the login animation
    PROGRESS_STAGES: [
        { percent: 0, text: 'Initializing secure connection...' },
        { percent: 15, text: 'Preparing a secure connection' },
        { percent: 35, text: 'Connecting to your school' },
        { percent: 50, text: 'School selected; continuing sign-in' },
        { percent: 65, text: 'Authenticating your account' },
        { percent: 85, text: 'Verifying your school session' },
        { percent: 100, text: 'Connected successfully' }
    ]
};
