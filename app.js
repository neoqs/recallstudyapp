/* ==========================================
   RECALL — STUDY APPLICATION
   Local question generation and OCR
========================================== */
"use strict";
const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "recall_study_v1";
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const state = {
    materials: [],
    history: [],
    quiz: null,
    currentQuestion: 0,
    answers: [],
    revealed: [],
    mode: "practice"
};
const LETTERS = ["A", "B", "C", "D"];
/* ---------- Status messages ---------- */
function setUploadStatus(message) {
    const element = $("uploadStatus");
    if (element) element.textContent = message;
}
function setStudyStatus(message) {
    const element = $("studyStatus");
    if (element) element.textContent = message;
}
/* ---------- Utilities ---------- */
function makeId() {
    return window.crypto && crypto.randomUUID
        ? crypto.randomUUID()
        : Date.now().toString(36) +
          Math.random().toString(36).slice(2);
}
function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}
function wordCount(text) {
    return text.trim() ? text.trim().split(/\s+/).length : 0;
}
function formatDate(value) {
    return new Date(value).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric"
    });
}
/* ---------- Saving and loading ---------- */
function loadState() {
    try {
        const saved = JSON.parse(
            localStorage.getItem(STORAGE_KEY) || "{}"
        );
        state.materials = Array.isArray(saved.materials)
            ? saved.materials
            : [];
        state.history = Array.isArray(saved.history)
            ? saved.history
            : [];
    } catch (error) {
        console.error("Recall could not load saved data:", error);
    }
}
function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            materials: state.materials,
            history: state.history
        }));
        return true;
    } catch (error) {
        console.error("Recall could not save data:", error);
        setUploadStatus(
            "Browser storage is full. Try deleting an old study material."
        );
        return false;
    }
}
/* ---------- Text extraction and OCR ---------- */
async function recogniseImage(file) {
    if (!window.Tesseract) {
        throw new Error(
            "The OCR library did not load. Check your internet connection."
        );
    }
    setUploadStatus("Recognising text in " + file.name + "...");
    const result = await Tesseract.recognize(file, "eng", {
        logger: (message) => {
            if (message.status === "recognizing text") {
                const percent = Math.round(
                    (message.progress || 0) * 100
                );
                setUploadStatus(
                    "Reading " + file.name + ": " + percent + "%"
                );
            }
        }
    });
    return result.data.text || "";
}
async function extractFileText(file) {
    const name = file.name.toLowerCase();
    if (
        file.type.startsWith("image/") ||
        /\.(jpg|jpeg|png|webp|bmp|tif|tiff)$/i.test(name)
    ) {
        return recogniseImage(file);
    }
    if (/\.(txt|md|markdown)$/i.test(name)) {
        return file.text();
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
        let characterCount = 0;
        for (let number = 1; number <= pdf.numPages; number++) {
            setUploadStatus(
                "Reading PDF page " + number + " of " + pdf.numPages + "..."
            );
            const page = await pdf.getPage(number);
            const content = await page.getTextContent();
            const text = content.items
                .map((item) => item.str || "")
                .join(" ");
            pages.push(text);
            characterCount += text.trim().length;
        }
        if (characterCount > 30) {
            return pages.join("\n\n");
        }
        // Scanned PDF fallback: render pages and recognise text.
        if (!window.Tesseract) {
            throw new Error(
                "This appears to be a scanned PDF, but OCR did not load."
            );
        }
        const recognisedPages = [];
        for (let number = 1; number <= pdf.numPages; number++) {
            setUploadStatus(
                "Recognising scanned PDF page " +
                number + " of " + pdf.numPages + "..."
            );
            const page = await pdf.getPage(number);
            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d");
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            await page.render({
                canvasContext: context,
                viewport: viewport
            }).promise;
            const result = await Tesseract.recognize(canvas, "eng");
            recognisedPages.push(result.data.text || "");
            canvas.width = 0;
            canvas.height = 0;
        }
        return recognisedPages.join("\n\n");
    }
    throw new Error(
        "Unsupported file type. Use PDF, DOCX, TXT, MD, or an image."
    );
}
/* ---------- File upload ---------- */
async function processFiles(files) {
    for (const file of files) {
        const supported =
            /\.(pdf|docx|txt|md|markdown|jpg|jpeg|png|webp|bmp|tif|tiff)$/i
                .test(file.name) ||
            file.type.startsWith("image/");
        if (!supported) {
            setUploadStatus("Unsupported file: " + file.name);
            continue;
        }
        if (file.size > MAX_FILE_SIZE) {
            setUploadStatus(
                file.name + " exceeds the 15 MB limit."
            );
            continue;
        }
        setUploadStatus("Processing " + file.name + "...");
        try {
            const text = await extractFileText(file);
            if (!text.trim()) {
                setUploadStatus(
                    "No readable text was found in " + file.name +
                    ". Try a clearer image or document."
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
                renderLibrary();
                renderStats();
                continue;
            }
            renderLibrary();
            renderStats();
            setUploadStatus(
                "Successfully added " + file.name + " (" +
                material.words.toLocaleString() + " words)."
            );
        } catch (error) {
            console.error("Upload error:", error);
            setUploadStatus(
                "Could not read " + file.name + ": " + error.message
            );
        }
    }
}
async function handleFileUpload(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    await processFiles(files);
    // Allow the same file to be selected again.
    event.target.value = "";
}
/* ---------- Study library ---------- */
function renderLibrary() {
    const library = $("library");
    const select = $("materialSelect");
    if (!library || !select) return;
    if (!state.materials.length) {
        library.className = "empty-state";
        library.innerHTML = `
            <span class="empty-icon" aria-hidden="true">▱</span>
            <h3>Your library is waiting</h3>
            <p>Upload your first study material to get started.</p>
        `;
        select.innerHTML =
            '<option value="">Upload material first</option>';
        return;
    }
    library.className = "library-list";
    library.innerHTML = state.materials.map((material) => `
        <article class="library-item">
            <div class="item-main">
                <span class="item-icon" aria-hidden="true">FILE</span>
                <div class="item-details">
                    <strong>${escapeHTML(material.name)}</strong>
                    <span>
                        ${material.words.toLocaleString()} words ·
                        Added ${formatDate(material.addedAt)}
                    </span>
                </div>
            </div>
            <div class="item-actions">
                <button class="small-button" type="button"
                    data-action="study"
                    data-id="${escapeHTML(material.id)}">Study</button>
                <button class="small-button danger" type="button"
                    data-action="delete"
                    data-id="${escapeHTML(material.id)}">Delete</button>
            </div>
        </article>
    `).join("");
    const previousValue = select.value;
    select.innerHTML = state.materials.map((material) => `
        <option value="${escapeHTML(material.id)}">
            ${escapeHTML(material.name)}
        </option>
    `).join("");
    if (state.materials.some((item) => item.id === previousValue)) {
        select.value = previousValue;
    }
}
function handleLibraryClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const id = button.dataset.id;
    if (button.dataset.action === "delete") {
        const material = state.materials.find((item) => item.id === id);
        if (!material) return;
        if (!confirm('Delete "' + material.name + '"?')) return;
        state.materials = state.materials.filter(
            (item) => item.id !== id
        );
        if (state.quiz && state.quiz.materialId === id) {
            state.quiz = null;
            $("quizArea").hidden = true;
        }
        saveState();
        renderLibrary();
        renderStats();
        setUploadStatus("Material deleted.");
    }
    if (button.dataset.action === "study") {
        $("materialSelect").value = id;
        startStudySession();
        $("quizArea").scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
}
/* ---------- Question generation ---------- */
function splitSentences(text) {
    return text
        .replace(/\r/g, "\n")
        .split(/(?<=[.!?])\s+|\n+/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => {
            const words = wordCount(sentence);
            return words >= 5 &&
                words <= 55 &&
                /[a-zA-Z]/.test(sentence);
        });
}
function shuffle(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}
function chooseKeyword(sentence) {
    const stopWords = new Set([
        "about", "after", "again", "also", "among", "because",
        "before", "being", "between", "could", "does", "during",
        "each", "from", "have", "into", "more", "most", "other",
        "over", "same", "should", "some", "such", "than", "that",
        "their", "them", "then", "there", "these", "they", "this",
        "those", "through", "under", "very", "were", "what", "when",
        "where", "which", "while", "with", "would", "your"
    ]);
    const words = sentence.match(/[A-Za-z][A-Za-z'-]*/g) || [];
    const candidates = words.filter((word) =>
        word.length >= 5 && !stopWords.has(word.toLowerCase())
    );
    if (!candidates.length) return null;
    return candidates.sort((a, b) => b.length - a.length)[0];
}
function makeMCQ(prompt, correct, candidates, source) {
    const distractors = shuffle([
        ...new Set(candidates.filter((item) =>
            item.toLowerCase() !== correct.toLowerCase()
        ))
    ]).slice(0, 3);
    const options = shuffle([
        correct,
        ...distractors,
        ...Array(Math.max(0, 3 - distractors.length)).fill(
            "None of the other options"
        )
    ]);
    return {
        id: makeId(),
        type: "mcq",
        question: prompt,
        options,
        answer: options.indexOf(correct),
        explanation: "Compare the options with the source statement.",
        source
    };
}
function generateQuestions(material, amount, preferences) {
    const sentences = splitSentences(material.text);
    if (sentences.length < 2) {
        throw new Error(
            "There is not enough readable text to generate questions. " +
            "Try a longer document."
        );
    }
    const questionTypes = preferences.questionType === "mixed"
        ? ["mcq", "fillblank", "truefalse", "shortanswer"]
        : [preferences.questionType];
    const questions = [];
    const used = new Set();
    for (const sentence of shuffle(sentences)) {
        if (questions.length >= amount) break;
        if (used.has(sentence)) continue;
        const keyword = chooseKeyword(sentence);
        if (!keyword) continue;
        const type = questionTypes[questions.length % questionTypes.length];
        let question;
        if (type === "fillblank") {
            const blanked = sentence.replace(
                new RegExp(
                    "\\b" +
                    keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
                    "\\b",
                    "i"
                ),
                "______"
            );
            if (blanked === sentence) continue;
            question = {
                id: makeId(),
                type: "fillblank",
                question: "Complete the statement: " + blanked,
                options: [keyword],
                answer: 0,
                explanation: "Compare your answer with the original statement.",
                source: sentence
            };
        } else if (type === "truefalse") {
            question = {
                id: makeId(),
                type: "truefalse",
                question: "True or false: " + sentence,
                options: ["True", "False"],
                answer: 0,
                explanation:
                    "This statement is reproduced from the source material.",
                source: sentence
            };
        } else if (type === "shortanswer") {
            question = {
                id: makeId(),
                type: "shortanswer",
                question: "Explain this statement in your own words: " + sentence,
                options: [sentence],
                answer: 0,
                explanation: "Compare your response with the source statement.",
                source: sentence
            };
        } else {
            question = makeMCQ(
                "Which statement is taken from your study material?",
                sentence,
                sentences.filter((item) => item !== sentence),
                sentence
            );
        }
        question.difficulty = preferences.difficulty;
        question.thinkingSkill = preferences.thinkingSkill;
        questions.push(question);
        used.add(sentence);
    }
    if (!questions.length) {
        throw new Error("Could not generate questions from this material.");
    }
    return questions;
}
/* ---------- Study session ---------- */
function startStudySession() {
    const material = state.materials.find(
        (item) => item.id === $("materialSelect").value
    );
    if (!material) {
        setStudyStatus("Please upload and select a study material first.");
        return;
    }
    const preferences = {
        questionType: $("questionType").value,
        difficulty: $("difficulty").value,
        thinkingSkill: $("thinkingSkill").value
    };
    try {
        const amount = Number($("questionAmount").value) || 10;
        const questions = generateQuestions(
            material,
            Math.max(1, Math.min(amount, 50)),
            preferences
        );
        state.quiz = {
            materialId: material.id,
            materialName: material.name,
            questions
        };
        state.currentQuestion = 0;
        state.answers = Array(questions.length).fill(null);
        state.revealed = Array(questions.length).fill(false);
        state.mode = $("studyMode").value;
        $("quizArea").hidden = false;
        setStudyStatus(
            "Session ready: " + questions.length + " questions."
        );
        renderQuestion();
    } catch (error) {
        console.error("Study session error:", error);
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
    const written = ["shortanswer", "fillblank"].includes(question.type);
    const answeredCount = state.answers.filter(
        (answer) => answer !== null
    ).length;
    let optionsHTML = "";
    if (written) {
        optionsHTML = `
            <div class="field">
                <label for="writtenAnswer">Your answer</label>
                <textarea id="writtenAnswer" rows="3"
                    placeholder="Write your answer here..."
                    ${revealed ? "disabled" : ""}>${escapeHTML(
                        question.userText || ""
                    )}</textarea>
            </div>
        `;
    } else {
        optionsHTML = question.options.map((option, optionIndex) => {
            let classes = "answer-option";
            if (chosen === optionIndex) classes += " selected";
            if (revealed && optionIndex === question.answer) {
                classes += " correct";
            } else if (
                revealed &&
                chosen === optionIndex &&
                chosen !== question.answer
            ) {
                classes += " incorrect";
            }
            return `
                <button type="button" class="${classes}"
                    data-option="${optionIndex}"
                    ${revealed ? "disabled" : ""}>
                    <span class="option-letter">
                        ${LETTERS[optionIndex] || ""}
                    </span>
                    <span>${escapeHTML(option)}</span>
                </button>
            `;
        }).join("");
    }
    let feedbackHTML = "";
    if (revealed) {
        const isWritten = written;
        const correct = !isWritten && chosen === question.answer;
        feedbackHTML = `
            <div class="answer-feedback ${
                correct ? "correct-feedback" : "incorrect-feedback"
            }">
                <strong>${
                    isWritten
                        ? "Suggested answer"
                        : correct
                            ? "Correct!"
                            : "Review this answer."
                }</strong>
                <p>${escapeHTML(question.options[question.answer])}</p>
                <p>${escapeHTML(question.explanation)}</p>
                <p><strong>Source:</strong> ${
                    escapeHTML(question.source)
                }</p>
            </div>
        `;
    }
    const controlsHTML = revealed
        ? `<button class="primary-button" id="nextButton" type="button">
            ${index === quiz.questions.length - 1
                ? "Finish session"
                : "Next question →"}
           </button>`
        : `<button class="primary-button" id="revealButton" type="button"
            ${chosen === null ? "disabled" : ""}>Check answer</button>`;
    $("quizArea").innerHTML = `
        <div class="quiz-progress">
            <span>Question ${index + 1} of ${quiz.questions.length}</span>
            <span>${answeredCount} answered</span>
        </div>
        <div class="progress-track">
            <div class="progress-fill" style="width:${
                ((index + 1) / quiz.questions.length) * 100
            }%"></div>
        </div>
        <div class="question-card">
            <div class="eyebrow">${escapeHTML(question.type.toUpperCase())}</div>
            <h3>${escapeHTML(question.question)}</h3>
            <div class="answer-options">${optionsHTML}</div>
            ${feedbackHTML}
            <div class="quiz-controls">${controlsHTML}</div>
        </div>
    `;
    $("quizArea").querySelectorAll("[data-option]").forEach((button) => {
        button.addEventListener("click", () => {
            state.answers[index] = Number(button.dataset.option);
            renderQuestion();
        });
    });
    const writtenInput = $("writtenAnswer");
    if (writtenInput) {
        writtenInput.addEventListener("input", () => {
            question.userText = writtenInput.value;
            state.answers[index] = writtenInput.value.trim()
                ? writtenInput.value.trim()
                : null;
            const button = $("revealButton");
            if (button) button.disabled = !writtenInput.value.trim();
        });
    }
    if ($("revealButton")) {
        $("revealButton").addEventListener("click", () => {
            if (state.answers[index] === null) return;
            state.revealed[index] = true;
            renderQuestion();
        });
    }
    if ($("nextButton")) {
        $("nextButton").addEventListener("click", () => {
            if (index < quiz.questions.length - 1) {
                state.currentQuestion++;
                renderQuestion();
            } else {
                finishSession();
            }
        });
    }
}
/* ---------- Results and history ---------- */
function finishSession() {
    const quiz = state.quiz;
    if (!quiz) return;
    const total = quiz.questions.length;
    // Written responses are not automatically graded.
    const gradable = quiz.questions
        .map((question, index) => ({ question, index }))
        .filter(({ question }) =>
            !["shortanswer", "fillblank"].includes(question.type)
        );
    const correct = gradable.filter(({ question, index }) =>
        state.answers[index] === question.answer
    ).length;
    const record = {
        id: makeId(),
        materialName: quiz.materialName,
        date: new Date().toISOString(),
        total,
        answered: state.answers.filter((answer) => answer !== null).length,
        correct,
        accuracy: gradable.length
            ? Math.round((correct / gradable.length) * 100)
            : 0,
        mode: state.mode
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
            <p class="result-message">
                You answered ${correct} of ${gradable.length}
                automatically gradable questions correctly.
            </p>
            <p class="result-message">
                Written answers require your own review.
            </p>
            <button class="primary-button" id="restartButton" type="button">
                New session
            </button>
        </div>
    `;
    $("restartButton").addEventListener("click", () => {
        $("quizArea").hidden = true;
        setStudyStatus("Choose your settings and start another session.");
    });
    setStudyStatus("Session completed and saved.");
}
function renderHistory() {
    const history = $("history");
    if (!history) return;
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
                    <span>
                        ${formatDate(record.date)} ·
                        ${record.correct}/${record.total} correct
                    </span>
                </div>
            </div>
            <strong>${record.accuracy}%</strong>
        </article>
    `).join("");
}
/* ---------- Statistics ---------- */
function renderStats() {
    if ($("materialCount")) {
        $("materialCount").textContent = state.materials.length;
    }
    const answered = state.history.reduce(
        (sum, record) => sum + record.answered,
        0
    );
    if ($("questionCount")) {
        $("questionCount").textContent = answered;
    }
    const total = state.history.reduce(
        (sum, record) => sum + record.total,
        0
    );
    const correct = state.history.reduce(
        (sum, record) => sum + record.correct,
        0
    );
    if ($("accuracy")) {
        $("accuracy").textContent = (
            total ? Math.round(correct / total * 100) : 0
        ) + "%";
    }
}
/* ---------- Application startup ---------- */
function initializeRecall() {
    loadState();
    renderLibrary();
    renderHistory();
    renderStats();
    const fileInput = $("fileInput");
    if (fileInput) {
        fileInput.addEventListener("change", handleFileUpload);
    } else {
        console.error("Recall could not find the fileInput element.");
    }
    const cameraInput = $("cameraInput");
    if (cameraInput) {
        cameraInput.addEventListener("change", handleFileUpload);
    }
    if ($("library")) {
        $("library").addEventListener("click", handleLibraryClick);
    }
    if ($("startButton")) {
        $("startButton").addEventListener("click", startStudySession);
    }
    setUploadStatus("Choose a file to upload.");
    setStudyStatus(
        "Upload your notes, choose your preferences, and start studying."
    );
}
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeRecall);
} else {
    initializeRecall();
}
