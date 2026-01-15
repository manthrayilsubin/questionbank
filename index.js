const express = require('express');
const { Database } = require('@sqlitecloud/drivers');

const app = express();
const PORT = 5000;

app.use(express.urlencoded({ extended: true }));

// ==================== CONFIGURATION ====================
// REPLACE WITH YOUR REAL CONNECTION STRING
const SQLITECLOUD_CONNECTION_STRING = process.env['sqlitevar'];

if (!SQLITECLOUD_CONNECTION_STRING || SQLITECLOUD_CONNECTION_STRING.includes('your-')) {
    console.error('\n⚠️  Please replace the placeholder with your real SQLite Cloud connection string!\n');
    process.exit(1);
}
// ======================================================

let db = null;
let currentQuestions = [];
let totalQuestions = 0;

// Connect to database
async function connectDB() {
    try {
        db = new Database(SQLITECLOUD_CONNECTION_STRING);
        console.log('Connected to SQLite Cloud');
    } catch (err) {
        console.error('Failed to connect:', err.message);
        process.exit(1);
    }
}

// Gracefully close DB
async function closeDB() {
    if (db) {
        try {
            await db.close();
            console.log('\nSQLite Cloud connection closed gracefully.');
        } catch (err) {
            console.error('\nError closing connection:', err.message);
        }
    }
}

// Start new quiz: reset ALL questions to unused, then load 5 random unused ones
async function startNewQuiz() {
    try {
        // Reset all questions to unused at the start of a new quiz
        //await db.sql`UPDATE questions SET used = 0`;

        const countResult = await db.sql`SELECT COUNT(*) AS total FROM questions`;
        const available = countResult[0].total;

        if (available === 0) {
            currentQuestions = [];
            totalQuestions = 0;
            return;
        }

        const limit = Math.min(5, available);

        const rows = await db.sql`
            SELECT id, question, correct_answer,imgUrl
            FROM questions 
            WHERE used = 0 
            ORDER BY RANDOM() 
            LIMIT ${limit}
        `;

        currentQuestions = rows;
        totalQuestions = rows.length;

        console.log(`New quiz started: ${totalQuestions} fresh questions loaded (only correct answers mark them as used).`);
    } catch (err) {
        console.error('Error starting quiz:', err.message);
        currentQuestions = [];
        totalQuestions = 0;
    }
}

// Navigation buttons
function getNavButtons(currentId) {
    const prevLink = currentId <= 1
        ? '<span style="color:#aaa;">« Previous</span>'
        : `<a href="/question/${currentId - 1}">« Previous</a>`;

    const nextLink = currentId >= totalQuestions
        ? '<span style="color:#aaa;">Next »</span>'
        : `<a href="/question/${currentId + 1}">Next »</a>`;

    return `
        <div style="text-align:center; margin:30px 0; font-size:18px;">
            ${prevLink} &nbsp;&nbsp;&nbsp;&nbsp; ${nextLink}
        </div>
        <div style="text-align:center; color:#666; font-size:14px;">
            Question ${currentId} of ${totalQuestions}
        </div>`;
}

// Start server after DB connection
connectDB().then(() => {
    const server = app.listen(PORT, () => {
        console.log(`\nQuiz App running: http://localhost:${PORT}`);
        console.log(`→ Questions are marked as 'used' ONLY when answered correctly!\n`);
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        await closeDB();
        server.close(() => process.exit(0));
    });

    process.on('SIGTERM', async () => {
        console.log('\nShutting down...');
        await closeDB();
        server.close(() => process.exit(0));
    });
});

// Routes

app.get('/', async (req, res) => {
    await startNewQuiz();
    if (totalQuestions === 0) {
        res.send('<h2 style="text-align:center;margin-top:100px;">No questions in database.</h2>');
    } else {
        res.redirect('/question/1');
    }
});

app.get('/question/:id', (req, res) => {
    const id = parseInt(req.params.id);
    if (totalQuestions === 0 || isNaN(id) || id < 1 || id > totalQuestions) {
        return res.status(404).send('<h2>Invalid question</h2><p><a href="/">← Start New Quiz</a></p>');
    }

    const q = currentQuestions[id - 1];

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Question ${id}</title>
    <style>
        body {font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.6;}
        h1 {text-align: center;}
        .question-box {background: #f8f9fa; padding: 30px; border-radius: 12px; margin: 30px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1);}
        input[type="text"] {width: 100%; padding: 14px; font-size: 18px; margin-top: 15px; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box;}
        button {padding: 14px 30px; font-size: 18px; background: #28a745; color: white; border: none; border-radius: 6px; cursor: pointer;}
        button:hover {background: #218838;}
        a {text-decoration: none; color: #007bff; font-weight: bold; font-size: 18px;}
        .restart {text-align: center; margin: 50px 0; font-size: 16px;}
        .info {background: #e7f3ff; padding: 15px; border-radius: 8px; margin-bottom: 20px; font-size: 15px;}
    </style>
</head>
<body>
    <h1>Smart Quiz</h1>
    <div class="info">
        <strong>Tip:</strong> Questions you answer <strong>correctly</strong> won't appear again until you start a new quiz.
    </div>
    ${getNavButtons(id)}

    <div class="question-box">
        <strong style="font-size:20px;">Question ${id}:</strong>
        <p style="font-size: 22px; margin: 25px 0;">${q.question}</p>
        #imgHolder
        <form action="/question/${id}" method="POST">
            <input type="text" name="user_answer" placeholder="Your answer" required autofocus>
            <button type="submit">Submit Answer</button>
        </form>
    </div>

    ${getNavButtons(id)}
    <div class="restart"><a href="/">← Start New Quiz (resets all questions)</a></div>
</body>
</html>`;
    if(q.imgUrl == null)
        html=html.replace('#imgHolder','');
    else
        html=html.replace('#imgHolder',`<img src="${q.imgUrl}" alt="Question Image" style="max-width: 50%; height: auto; margin: 20px 0;">`);
    
    res.send(html);
});

app.post('/question/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (totalQuestions === 0 || isNaN(id) || id < 1 || id > totalQuestions) {
        return res.status(404).send('<h2>Invalid question</h2><p><a href="/">← Start New Quiz</a></p>');
    }

    const q = currentQuestions[id - 1];
    const userAnswer = (req.body.user_answer || '').trim();
    const correctAnswer = (q.correct_answer || '').trim();

    const isCorrect = userAnswer.toLowerCase() === correctAnswer.toLowerCase();
    
    if (isCorrect) {
        try {
            await db.sql`UPDATE questions SET used = 1 WHERE id = ${q.id}`;
            console.log(`Question ${q.id} marked as used (correct answer)`);
        } catch (err) {
            console.error('Failed to update used flag:', err.message);
        }
    }

    // Hide correct answer from feedback
    const feedback = `
        <div style="padding:20px; margin:25px 0; border-radius:8px; font-size:18px;
                    background:${isCorrect ? '#d4edda' : '#f8d7da'};
                    border-left:6px solid ${isCorrect ? '#28a745' : '#dc3545'};">
            <strong style="font-size:22px;">${isCorrect ? '✓ Correct! This question is now mastered.' : '✗ Wrong'}</strong><br><br>
            <strong>Your answer:</strong> "${userAnswer || '(empty)'}"<br>
             <strong>Correct answer:</strong> "${correctAnswer}"<br>
            ${isCorrect ? '<br><em>You won\'t see this question again until restarting the quiz.</em>' : '<br><em>Try again — it may appear in future quizzes until you get it right!</em>'}
        </div>`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Question ${id} - Result</title>
    <style>
        body {font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.6;}
        h1 {text-align: center;}
        .question-box {background: #f8f9fa; padding: 30px; border-radius: 12px; margin: 30px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1);}
        input[type="text"] {width: 100%; padding: 14px; font-size: 18px; margin-top: 15px; border: 1px solid #ccc; border-radius: 6px;}
        button {padding: 14px 30px; font-size: 18px; background: #007bff; color: white; border: none; border-radius: 6px; cursor: pointer;}
        button:hover {background: #0056b3;}
        a {text-decoration: none; color: #007bff; font-weight: bold; font-size: 18px;}
        .restart {text-align: center; margin: 50px 0; font-size: 16px;}
        .info {background: #e7f3ff; padding: 15px; border-radius: 8px; margin-bottom: 20px; font-size: 15px;}
    </style>
</head>
<body>
    <h1>Smart Quiz</h1>
    <div class="info">
        <strong>Tip:</strong> Only <strong>correct</strong> answers remove a question permanently (until new quiz).
    </div>
    ${getNavButtons(id)}

    <div class="question-box">
        <strong style="font-size:20px;">Question ${id}:</strong>
        <p style="font-size: 22px; margin: 25px 0;">${q.question}</p>

        ${feedback}

        <form action="/question/${id}" method="POST">
            <input type="text" name="user_answer" placeholder="Try again" autofocus>
            <button type="submit">Submit Again</button>
        </form>

        <p style="text-align:center; margin-top:30px; color:#666;">
            Use Previous / Next to continue
        </p>
    </div>

    ${getNavButtons(id)}
    <div class="restart"><a href="/">← Start New Quiz (resets progress)</a></div>
</body>
</html>`;

    res.send(html);
});