“use strict”;

/* ==========================================
RECALL — STUDY APPLICATION
Local question generation and OCR
========================================== */

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = “recall_study_v1”;

const state = {
materials: [],
questionBank: {},
history: [],
quiz: null,
currentQuestion: 0,
answers: [],
revealed: [],
mode: “practice”
};

const LETTERS = [“A”, “B”, “C”, “D”];

/* ––––– Persistent local storage ––––– */

function loadState() {
try {
const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));

    if (saved && typeof saved === "object") {
        state.materials = Array.isArray(saved.materials)
            ? saved.materials : [];
        state.questionBank =
            saved.questionBank && typeof saved.questionBank === "object"
                ? saved.questionBank : {};
        state.history = Array.isArray(saved.history)
            ? saved.history : [];
    }
} catch (error) {
    console.error("Could not load Recall data:", error);
}

}

function saveState() {
try {
localStorage.setItem(STORAGE_KEY, JSON.stringify({
materials: state.materials,
questionBank: state.questionBank,
history: state.history
}));
return true;
} catch (error) {
console.error(“Could not save Recall data:”, error);
setUploadStatus(
“Browser storage is full. Try removing a large material.”
);
return false;
}
}

/* ––––– Utilities ––––– */

function makeId() {
return window.crypto && crypto.randomUUID
? crypto.randomUUID()
: Date.now().toString(36) +
Math.random().toString(36).slice(2);
}

function escapeHTML(value) {
return String(value ?? “”).replace(/[&<>”’]/g, (character) => ({
“&”: “&”,
“<”: “<”,
“>”: “>”,
‘”’: “"”,
“’”: “'”
})[character]);
}

function formatDate(value) {
return new Date(value).toLocaleDateString(undefined, {
day: “numeric”,
month: “short”,
year: “numeric”
});
}

function wordCount(text) {
return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function setUploadStatus(message) {
$(“uploadStatus”).textContent = message;
}

function setStudyStatus(message) {
$(“studyStatus”).textContent = message;
}

/* ––––– Text extraction and OCR ––––– */

async function recogniseImage(file) {
if (!window.Tesseract) {
throw new Error(
“The OCR library did not load. Check your internet connection.”
);
}

setUploadStatus(
    "Recognising text in " + file.name +
    ". This may take a while..."
);
const result = await Tesseract.recognize(
    file,
    "eng",
    {
        logger: (message) => {
            if (message.status === "recognizing text") {
                setUploadStatus(
                    "Reading " + file.name + ": " +
                    Math.round((message.progress || 0) * 100) +
                    "%..."
                );
            }
        }
    }
);
return result.data.text || "";

}

async function extractFileText(file) {
const name = file.name.toLowerCase();
const isImage = /.(jpg|jpeg|png|webp|bmp|tif|tiff)$/i.test(name)
|| file.type.startsWith(“image/”);

if (isImage) {
    return await recogniseImage(file);
}
if (/\.(txt|md|markdown)$/i.test(name)) {
    return await file.text();
}
if (name.endsWith(".docx")) {
    if (!window.mammoth) {
        throw new Error("The Word document reader did not load.");
    }
    const result = await mammoth.extractRawText({
        arrayBuffer: await file.arrayBuffer()
    });
    return result.value || "";
}
if (name.endsWith(".pdf")) {
    if (!window.pdfjsLib) {
        throw new Error("The PDF reader did not load.");
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const pdf = await pdfjsLib.getDocument({
        data: await file.arrayBuffer()
    }).promise;
    const pages = [];
    let totalCharacters = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        setUploadStatus(
            "Reading PDF page " + pageNumber +
            " of " + pdf.numPages + "..."
        );
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const pageText = content.items
            .map((item) => item.str || "")
            .join(" ");
        pages.push(pageText);
        totalCharacters += pageText.trim().length;
    }
    if (totalCharacters > 30) {
        return pages.join("\n\n");
    }
    /*
     * Scanned PDF fallback:
     * Render each page to a canvas, then run OCR.
     */
    const ocrPages = [];
    if (!window.Tesseract) {
        throw new Error(
            "This PDF appears to be scanned, but the OCR library " +
            "did not load. Please check your internet connection."
        );
    }
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        setUploadStatus(
            "Recognising scanned PDF page " + pageNumber +
            " of " + pdf.numPages + "..."
        );
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({
            canvasContext: context,
            viewport: viewport
        }).promise;
        const result = await Tesseract.recognize(
            canvas,
            "eng"
        );
        ocrPages.push(result.data.text || "");
        canvas.width = 0;
        canvas.height = 0;
    }
    return ocrPages.join("\n\n");
}
throw new Error("Unsupported file type: " + file.name);

}

/* ––––– Upload processing ––––– */

async function processFiles(files) {
for (const file of files) {
const supported =
/.(pdf|docx|txt|md|markdown|jpg|jpeg|png|webp|bmp|tif|tiff)$/i
.test(file.name) ||
file.type.startsWith(“image/”);

    if (!supported) {
        setUploadStatus("Unsupported file: " + file.name);
        continue;
    }
    if (file.size > 15 * 1024 * 1024) {
        setUploadStatus(
            file.name + " is larger than 15 MB. Please use a smaller file."
        );
        continue;
    }
    setUploadStatus("Processing " + file.name + "...");
    try {
        const text = await extractFileText(file);
        if (!text.trim()) {
            setUploadStatus(
                "No readable text was found in " + file.name +
                ". Try a clearer image or a text-based document."
            );
            continue;
        }
        const material = {
            id: makeId(),
            name: file.name,
            text: text.slice(0, 100000),
            words: wordCount(text),
            addedAt: new Date().toISOString()
        };
        state.materials.push(material);
        if (!saveState()) {
            state.materials.pop();
            continue;
        }
        renderLibrary();
        renderStats();
        setUploadStatus(
            "Added " + file.name + " successfully (" +
            material.words.toLocaleString() + " words)."
        );
    } catch (error) {
        console.error(error);
        setUploadStatus(
            "Could not read " + file.name + ": " + error.message
        );
    }
}

}

async function handleFileUpload(event) {
const files = Array.from(event.target.files || []);
if (files.length) await processFiles(files);
event.target.value = “”;
}

/* ––––– Study library ––––– */

function renderLibrary() {
const library = $(“library”);
const select = $(“materialSelect”);

if (!state.materials.length) {
    library.className = "empty-state";
    library.innerHTML = `
        <span class="empty-icon" aria-hidden="true">▱</span>
        <h3>Your library is waiting</h3>
        <p>Upload your first study material to get started.</p>
    `;
    select.innerHTML = '<option value="">Upload material first</option>';
    return;
}
library.className = "library-list";
library.innerHTML = state.materials.map((material) => `
    <article class="library-item">
        <div class="item-main">
            <span class="item-icon" aria-hidden="true">FILE</span>
            <div class="item-details">
                <strong>${escapeHTML(material.name)}</strong>
                <span>${material.words.toLocaleString()} words · Added ${formatDate(material.addedAt)}</span>
            </div>
        </div>
        <div class="item-actions">
            <button class="small-button" type="button"
                data-action="study" data-id="${escapeHTML(material.id)}">Study</button>
            <button class="small-button danger" type="button"
                data-action="delete" data-id="${escapeHTML(material.id)}">Delete</button>
        </div>
    </article>
`).join("");
const previousValue = select.value;
select.innerHTML = state.materials.map((material) => `
    <option value="${escapeHTML(material.id)}">${escapeHTML(material.name)}</option>
`).join("");
if (state.materials.some((item) => item.id === previousValue)) {
    select.value = previousValue;
}

}

function deleteMaterial(id) {
const material = state.materials.find((item) => item.id === id);
if (!material) return;

if (!confirm('Delete "' + material.name + '" and its saved questions?')) {
    return;
}
state.materials = state.materials.filter((item) => item.id !== id);
delete state.questionBank[id];
if (state.quiz && state.quiz.materialId === id) {
    state.quiz = null;
    $("quizArea").hidden = true;
}
saveState();
renderLibrary();
renderStats();
setUploadStatus("Material deleted.");

}

function handleLibraryClick(event) {
const button = event.target.closest(“button[data-action]”);
if (!button) return;

if (button.dataset.action === "delete") {
    deleteMaterial(button.dataset.id);
}
if (button.dataset.action === "study") {
    $("materialSelect").value = button.dataset.id;
    startStudySession();
    $("quizArea").scrollIntoView({ behavior: "smooth", block: "start" });
}

}

/* ––––– Local question generation ––––– */

function splitSentences(text) {
return text
.replace(/\r/g, “\n”)
.split(/(?<=[.!?])\s+|\n+/)
.map((sentence) => sentence.trim())
.filter((sentence) => {
const words = wordCount(sentence);
return words >= 5 && words <= 55 && /[a-zA-Z]/.test(sentence);
});
}

function shuffle(items) {
const result = […items];

for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
}
return result;

}

function makeOptions(correct, candidates) {
const distractors = shuffle([…new Set(
candidates.filter((candidate) =>
candidate.toLowerCase() !== correct.toLowerCase()
)
)]).slice(0, 3);

const options = [correct, ...distractors];
while (options.length < 4) {
    options.push("None of the other options");
}
const shuffled = shuffle(options);
return {
    options: shuffled,
    answer: shuffled.indexOf(correct)
};

}

function chooseKeyword(sentence) {
const stopWords = new Set([
“about”, “after”, “again”, “also”, “among”, “because”,
“before”, “being”, “between”, “could”, “does”, “during”,
“each”, “from”, “have”, “into”, “more”, “most”, “other”,
“over”, “same”, “should”, “some”, “such”, “than”, “that”,
“their”, “them”, “then”, “there”, “these”, “they”, “this”,
“those”, “through”, “under”, “very”, “were”, “what”, “when”,
“where”, “which”, “while”, “with”, “would”, “your”
]);

const words = sentence.match(/[A-Za-z][A-Za-z'-]*/g) || [];
const candidates = words.filter((word) =>
    word.length >= 5 &&
    !stopWords.has(word.toLowerCase())
);
if (!candidates.length) return null;
return candidates.sort((a, b) => b.length - a.length)[0];

}

function makeMCQ(question, correct, candidates, source) {
const generated = makeOptions(correct, candidates);

return {
    id: makeId(),
    type: "mcq",
    question,
    options: generated.options,
    answer: generated.answer,
    explanation: "Review the source statement in your uploaded material: " + source,
    source
};

}

function generateLocalQuestions(material, amount, preferences = {}) {
const sentences = splitSentences(material.text);

if (sentences.length < 2) {
    throw new Error(
        "There is not enough readable text to create questions. " +
        "Try uploading a longer document."
    );
}
const candidates = shuffle(sentences);
const questions = [];
const used = new Set();
const requestedType = preferences.questionType || "mixed";
const difficulty = preferences.difficulty || "mixed";
const thinkingSkill = preferences.thinkingSkill || "mixed";
const types = requestedType === "mixed"
    ? ["definition", "comprehension", "fillblank", "truefalse"]
    : [requestedType];
for (const sentence of candidates) {
    if (questions.length >= amount) break;
    const keyword = chooseKeyword(sentence);
    if (!keyword) continue;
    const type = types[questions.length % types.length];
    let question = null;
    if (type === "fillblank") {
        const blanked = sentence.replace(
            new RegExp("\\b" + keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i"),
            "______"
        );
        if (blanked === sentence) continue;
        question = {
            id: makeId(),
            type: "fillblank",
            question: "Complete the statement: " + blanked,
            options: [keyword],
            answer: 0,
            explanation: "The missing word appears in the original statement.",
            source: sentence
        };
    } else if (type === "truefalse") {
        const isTrue = Math.random() > 0.35;
        question = {
            id: makeId(),
            type: "truefalse",
            question: "True or false: " + sentence,
            options: ["True", "False"],
            answer: isTrue ? 0 : 1,
            explanation: isTrue
                ? "This statement matches the source material."
                : "This is a practice judgement. Compare the statement with the source material before relying on it.",
            source: sentence
        };
        /*
         * This fallback does not have semantic understanding,
         * so it only uses verifiable true statements.
         */
        question.answer = 0;
        question.question = "True or false: " + sentence;
    } else if (type === "shortanswer") {
        question = {
            id: makeId(),
            type: "shortanswer",
            question: "In your own words, explain this statement: " + sentence,
            options: [sentence],
            answer: 0,
            explanation: "Compare your response with the original statement.",
            source: sentence
        };
    } else if (type === "definition") {
        question = makeMCQ(
            "Which statement best matches your study material?",
            sentence,
            candidates.filter((item) => item !== sentence),
            sentence
        );
    } else {
        const prompt = thinkingSkill === "applying"
            ? "Which statement from the material could help you understand a practical situation?"
            : thinkingSkill === "analysing"
                ? "Which statement is most relevant to analysing the topic?"
                : "Which of these statements best explains the material?";
        question = makeMCQ(
            prompt,
            sentence,
            candidates.filter((item) => item !== sentence),
            sentence
        );
    }
    if (!question || used.has(question.source)) continue;
    used.add(question.source);
    question.difficulty = difficulty;
    question.thinkingSkill = thinkingSkill;
    questions.push(question);
}
if (!questions.length) {
    throw new Error("Could not generate questions from this document.");
}
return questions;

}

/* ––––– Question bank ––––– */

function getQuestions(material, amount, preferences) {
/*
* Generate questions for each session so the selected settings
* are respected. The generated questions remain local.
*/
const questions = generateLocalQuestions(material, amount, preferences);

state.questionBank[material.id] = questions;
saveState();
return questions;

}

/* ––––– Quiz session ––––– */

function startStudySession() {
const material = state.materials.find(
(item) => item.id === $(“materialSelect”).value
);

if (!material) {
    setStudyStatus("Please upload and select a study material first.");
    return;
}
const amount = Number($("questionAmount").value);
const mode = $("studyMode").value;
const preferences = {
    questionType: $("questionType").value,
    difficulty: $("difficulty").value,
    thinkingSkill: $("thinkingSkill").value
};
try {
    const questions = getQuestions(material, amount, preferences);
    state.quiz = {
        materialId: material.id,
        materialName: material.name,
        questions,
        startedAt: new Date().toISOString()
    };
    state.currentQuestion = 0;
    state.answers = Array(questions.length).fill(null);
    state.revealed = Array(questions.length).fill(false);
    state.mode = mode;
    $("quizArea").hidden = false;
    setStudyStatus(
        "Session ready: " + questions.length +
        " questions. Mode: " + (mode === "exam" ? "Exam" : "Practice") + "."
    );
    renderQuestion();
} catch (error) {
    console.error(error);
    setStudyStatus(error.message);
}

}

function renderQuestion() {
const quiz = state.quiz;
if (!quiz) return;

const index = state.currentQuestion;
const question = quiz.questions[index];
const chosen = state.answers[index];
const revealed = state.revealed[index];
const answeredCount = state.answers.filter((answer) => answer !== null).length;
const percentage = ((index + 1) / quiz.questions.length) * 100;
const isShortAnswer = question.type === "shortanswer";
const isFillBlank = question.type === "fillblank";
let optionsHTML = "";
if (isShortAnswer || isFillBlank) {
    optionsHTML = `
        <div class="field">
            <label for="writtenAnswer">Your answer</label>
            <textarea id="writtenAnswer" rows="3"
                placeholder="Write your answer here..."
                ${revealed || (state.mode === "exam" && chosen !== null) ? "disabled" : ""}>${chosen !== null ? escapeHTML(question.userText || "") : ""}</textarea>
        </div>
    `;
} else {
    optionsHTML = question.options.map((option, optionIndex) => {
        let classes = "answer-option";
        if (chosen === optionIndex) classes += " selected";
        if (revealed && optionIndex === question.answer) {
            classes += " correct";
        } else if (revealed && chosen === optionIndex && chosen !== question.answer) {
            classes += " incorrect";
        }
        const disabled = revealed || (state.mode === "exam" && chosen !== null);
        return `
            <button type="button" class="${classes}"
                data-option="${optionIndex}" ${disabled ? "disabled" : ""}>
                <span class="option-letter">${LETTERS[optionIndex] || ""}</span>
                <span>${escapeHTML(option)}</span>
            </button>
        `;
    }).join("");
}
let feedbackHTML = "";
if (revealed) {
    const correct = chosen === question.answer;
    feedbackHTML = `
        <div class="answer-feedback ${correct ? "correct-feedback" : "incorrect-feedback"}">
            <strong>${correct ? "Correct!" : "Review this answer."}</strong>
            <p>Suggested answer: ${escapeHTML(question.options[question.answer])}</p>
            <p>${escapeHTML(question.explanation)}</p>
            <p><strong>Source:</strong> ${escapeHTML(question.source || "")}</p>
        </div>
    `;
}
let controlsHTML = "";
if (state.mode === "practice") {
    controlsHTML = !revealed
        ? `<button class="primary-button" id="revealButton" type="button"
            ${chosen === null ? "disabled" : ""}>Check answer</button>`
        : `<button class="primary-button" id="nextButton" type="button">
            ${index === quiz.questions.length - 1 ? "Finish session" : "Next question →"}
           </button>`;
} else {
    controlsHTML = `
        <button class="primary-button" id="examNextButton" type="button"
            ${chosen === null ? "disabled" : ""}>
            ${index === quiz.questions.length - 1 ? "Finish exam" : "Next question →"}
        </button>
    `;
}
$("quizArea").innerHTML = `
    <div class="quiz-progress">
        <span>Question ${index + 1} of ${quiz.questions.length}</span>
        <span>${answeredCount} answered</span>
    </div>
    <div class="progress-track">
        <div class="progress-fill" style="width:${percentage}%"></div>
    </div>
    <div class="question-card">
        <div class="eyebrow">${escapeHTML(question.type || "QUESTION").toUpperCase()}</div>
        <h3>${escapeHTML(question.question)}</h3>
        <div class="answer-options">${optionsHTML}</div>
        ${feedbackHTML}
        <div class="quiz-controls">${controlsHTML}</div>
    </div>
`;
$("quizArea").querySelectorAll("[data-option]").forEach((button) => {
    button.addEventListener("click", () => selectAnswer(Number(button.dataset.option)));
});
const writtenAnswer = $("writtenAnswer");
if (writtenAnswer) {
    writtenAnswer.addEventListener("input", () => {
        question.userText = writtenAnswer.value;
        state.answers[index] = writtenAnswer.value.trim() ? 0 : null;
        const button = $("revealButton") || $("examNextButton");
        if (button) button.disabled = !writtenAnswer.value.trim();
    });
}
if ($("revealButton")) {
    $("revealButton").addEventListener("click", revealAnswer);
}
if ($("nextButton")) {
    $("nextButton").addEventListener("click", nextQuestion);
}
if ($("examNextButton")) {
    $("examNextButton").addEventListener("click", () => {
        if (state.answers[index] === null) return;
        if (index === quiz.questions.length - 1) {
            finishSession();
        } else {
            state.currentQuestion++;
            renderQuestion();
        }
    });
}

}

function selectAnswer(optionIndex) {
if (!state.quiz) return;

const index = state.currentQuestion;
if (state.revealed[index]) return;
if (state.mode === "exam" && state.answers[index] !== null) return;
state.answers[index] = optionIndex;
renderQuestion();

}

function revealAnswer() {
if (!state.quiz || state.answers[state.currentQuestion] === null) return;

state.revealed[state.currentQuestion] = true;
renderQuestion();

}

function nextQuestion() {
if (!state.quiz) return;

if (state.currentQuestion < state.quiz.questions.length - 1) {
    state.currentQuestion++;
    renderQuestion();
} else {
    finishSession();
}

}

/* ––––– Results and review ––––– */

function finishSession() {
const quiz = state.quiz;
if (!quiz) return;

const total = quiz.questions.length;
const correct = state.answers.reduce((count, answer, index) => {
    return count + (answer === quiz.questions[index].answer ? 1 : 0);
}, 0);
const answered = state.answers.filter((answer) => answer !== null).length;
const record = {
    id: makeId(),
    materialId: quiz.materialId,
    materialName: quiz.materialName,
    date: new Date().toISOString(),
    total,
    answered,
    correct,
    accuracy: Math.round((correct / total) * 100),
    mode: state.mode,
    questions: quiz.questions.map((question, index) => ({
        question: question.question,
        options: question.options,
        answer: question.answer,
        selected: state.answers[index],
        explanation: question.explanation,
        source: question.source
    }))
};
state.history.unshift(record);
state.history = state.history.slice(0, 100);
saveState();
renderHistory();
renderStats();
$("quizArea").innerHTML = `
    <div class="question-card">
        <div class="eyebrow">SESSION COMPLETE</div>
        <h2>Your results</h2>
        <div class="result-score">${record.accuracy}%</div>
        <p class="result-message">You answered ${correct} out of ${total} questions correctly.</p>
        <p class="result-message">${answered < total
            ? "You left " + (total - answered) + " question(s) unanswered."
            : "Session complete. Review the source material for any uncertain answers."}</p>
        <div class="quiz-controls">
            <button class="secondary-button" id="reviewButton" type="button">Review answers</button>
            <button class="primary-button" id="restartButton" type="button">New session</button>
        </div>
    </div>
`;
$("reviewButton").addEventListener("click", () => showReview(record));
$("restartButton").addEventListener("click", () => {
    $("quizArea").hidden = true;
    setStudyStatus("Choose your settings and start another session.");
});
setStudyStatus("Session completed and saved.");

}

function showReview(record) {
$(“quizArea”).innerHTML = `
ANSWER REVIEW
Review your answers
${escapeHTML(record.materialName)}
${record.questions.map((question, index) => {
const selected = question.selected;
const isCorrect = selected === question.answer;

        return `
            <article class="question-card" style="margin-bottom:14px">
                <h3>${index + 1}. ${escapeHTML(question.question)}</h3>
                <p><strong>Your answer:</strong> ${
                    selected === null ? "Unanswered" :
                    escapeHTML(question.options[selected] || "Written response")
                }</p>
                <p><strong>Suggested answer:</strong> ${
                    escapeHTML(question.options[question.answer] || "")
                }</p>
                <p><strong>Result:</strong> ${isCorrect ? "Correct" : "Review needed"}</p>
                <p>${escapeHTML(question.explanation)}</p>
                <p><strong>Source:</strong> ${escapeHTML(question.source || "")}</p>
            </article>
        `;
    }).join("")}
    <button class="primary-button" id="backToResults" type="button">Close review</button>
`;
$("backToResults").addEventListener("click", () => {
    $("quizArea").innerHTML = `
        <div class="question-card">
            <h2>Review completed</h2>
            <p>Your session remains saved in your history.</p>
        </div>
    `;
});

}

function renderHistory() {
const history = $(“history”);

if (!state.history.length) {
    history.className = "empty-state";
    history.innerHTML = `
        <span class="empty-icon" aria-hidden="true">◷</span>
        <h3>No sessions yet</h3>
        <p>Your completed study sessions will appear here.</p>
    `;
    return;
}
history.className = "history-list";
history.innerHTML = state.history.map((record) => `
    <article class="history-item">
        <div class="item-main">
            <span class="item-icon" aria-hidden="true">✓</span>
            <div class="item-details">
                <strong>${escapeHTML(record.materialName)}</strong>
                <span>${formatDate(record.date)} · ${record.correct}/${record.total} correct · ${escapeHTML(record.mode)}</span>
            </div>
        </div>
        <strong>${record.accuracy}%</strong>
    </article>
`).join("");

}

/* ––––– Dashboard statistics ––––– */

function renderStats() {
$(“materialCount”).textContent = state.materials.length;

const answered = state.history.reduce(
    (total, record) => total + record.answered, 0
);
$("questionCount").textContent = answered;
const totalQuestions = state.history.reduce(
    (total, record) => total + record.total, 0
);
const totalCorrect = state.history.reduce(
    (total, record) => total + record.correct, 0
);
$("accuracy").textContent = (
    totalQuestions
        ? Math.round((totalCorrect / totalQuestions) * 100)
        : 0
) + "%";

}

/* ––––– Application startup ––––– */

function initializeRecall() {
loadState();

renderLibrary();
renderHistory();
renderStats();
$("fileInput").addEventListener("change", handleFileUpload);
if ($("cameraInput")) {
    $("cameraInput").addEventListener("change", handleFileUpload);
}
$("library").addEventListener("click", handleLibraryClick);
$("startButton").addEventListener("click", startStudySession);
setStudyStatus(
    "Upload your notes, choose your preferences, and start studying."
);

}

document.addEventListener(“DOMContentLoaded”, initializeRecall);
