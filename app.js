/* ==========================================
   RECALL — STUDY APPLICATION
   Gemini AI Question Generation and OCR
========================================== */
"use strict";

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "recall_study_v1";
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const AI_ENDPOINT = "https://young-snowflake-7a67.likheet9.workers.dev";

const state = {
    materials: [],
    history: [],
    quiz: null,
    currentQuestion: 0,
    answers: [],
    revealed: [],
    mode: "practice",
    generating: false
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

/* ---------- OCR validation ---------- */

function validateOCRText(text, confidence = 100) {
    const cleanedText = String(text || "")
        .replace(/\s+/g, " ")
        .trim();

    const words = cleanedText.match(/[a-zA-Z]{2,}/g) || [];
    const letters = cleanedText.match(/[a-zA-Z]/g) || [];

    const totalCharacters = cleanedText.length;

    const letterRatio = totalCharacters
        ? letters.length / totalCharacters
        : 0;

    const meaningfulWordRatio = words.length
        ? words.filter((word) => word.length >= 2).length / words.length
        : 0;

    if (cleanedText.length < 30 || words.length < 5) {
        throw new Error(
            "Recall could not read enough text from this file. " +
            "Please upload a clearer photo with the text fully visible."
        );
    }

    if (letterRatio < 0.45 || meaningfulWordRatio < 0.6) {
        throw new Error(
            "The text in this photo appears unclear or distorted. " +
            "Try taking a clearer photo with good lighting."
        );
    }

    if (confidence < 35) {
        throw new Error(
            "Recall could not recognise the text confidently. " +
            "Please upload a clearer photo."
        );
    }

    return cleanedText;
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

    return validateOCRText(
        result.data.text || "",
        Number(result.data.confidence || 0)
    );
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

            const validatedText = validateOCRText(
                result.data.text || "",
                Number(result.data.confidence || 0)
            );

            recognisedPages.push(validatedText);

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
        const material = state.materials.find(
            (item) => item.id === id
        );

        if (!material) return;

        if (!confirm('Delete "' + material.name + '"?')) return;

        state.materials = state.materials.filter(
            (item) => item.id !== id
        );

        if (state.quiz && state.quiz.materialId === id) {
            state.quiz = null;

            if ($("quizArea")) {
                $("quizArea").hidden = true;
            }
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

/* ==========================================
   RECALL AI — QUESTION GENERATION
========================================== */

/*
Expected AI response:
{
    "questions": [
        {
            "type": "mcq",
            "question": "Question text",
            "options": ["A", "B", "C", "D"],
            "answer": "Correct option",
            "explanation": "Explanation",
            "source": "Supporting source text"
        }
    ]
}
*/

function normalizeQuestionType(type, requestedType) {
    const allowed = [
        "mcq",
        "fillblank",
        "truefalse",
        "shortanswer"
    ];

    if (allowed.includes(type)) {
        return type;
    }

    if (allowed.includes(requestedType)) {
        return requestedType;
    }

    return "shortanswer";
}

function normalizeText(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function convertAIQuestion(raw, preferences) {
    if (!raw || typeof raw !== "object") {
        return null;
    }

    const type = normalizeQuestionType(
        String(raw.type || "").toLowerCase(),
        preferences.questionType
    );

    const questionText = String(raw.question || "").trim();

    if (!questionText) {
        return null;
    }

    const explanation = String(
        raw.explanation || "Review the source material."
    ).trim();

    const source = String(raw.source || "").trim();

    let options = [];
    let answer = 0;

    if (type === "mcq") {
        const rawOptions = Array.isArray(raw.options)
            ? raw.options.map((option) => String(option).trim())
            : [];

        const answerText = String(raw.answer ?? "").trim();

        if (
            rawOptions.length < 2 ||
            rawOptions.some((option) => !option)
        ) {
            return null;
        }

        options = rawOptions.slice(0, 4);

        let answerIndex = options.findIndex(
            (option) => normalizeText(option) === normalizeText(answerText)
        );

        // Also accept a valid numeric answer index.
        if (
            answerIndex === -1 &&
            /^\d+$/.test(answerText) &&
            Number(answerText) >= 0 &&
            Number(answerText) < options.length
        ) {
            answerIndex = Number(answerText);
        }

        if (answerIndex === -1) {
            return null;
        }

        answer = answerIndex;
    } else if (type === "truefalse") {
        options = ["True", "False"];

        const answerText = normalizeText(raw.answer);

        if (answerText === "true" || answerText === "t") {
            answer = 0;
        } else if (answerText === "false" || answerText === "f") {
            answer = 1;
        } else {
            return null;
        }
    } else {
        const answerText = String(raw.answer ?? "").trim();

        if (!answerText) {
            return null;
        }

        options = [answerText];
        answer = 0;
    }

    return {
        id: makeId(),
        type,
        question: questionText,
        options,
        answer,
        explanation,
        source: source || questionText,
        difficulty: preferences.difficulty,
        thinkingSkill: preferences.thinkingSkill
    };
}

async function generateAIQuestions(material, amount, preferences) {
    setStudyStatus("Recall AI is analysing your study material...");

    const payload = {
        text: material.text.slice(0, 60000),
        amount,
        questionType: preferences.questionType,
        difficulty: preferences.difficulty,
        thinkingSkill: preferences.thinkingSkill
    };

    let response;

    try {
        response = await fetch(AI_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });
    } catch (error) {
        throw new Error(
            "Could not connect to Recall AI. Check your internet connection " +
            "and confirm that your Cloudflare Worker is deployed."
        );
    }

    let data;

    try {
        data = await response.json();
    } catch (error) {
        throw new Error(
            "Recall AI returned an unreadable response. Please try again."
        );
    }

    if (!response.ok) {
        throw new Error(
            data.error ||
            "Recall AI could not generate questions. Please try again."
        );
    }

    if (!Array.isArray(data.questions)) {
        throw new Error(
            "Recall AI returned an invalid question list. Please try again."
        );
    }

    const questions = data.questions
        .map((question) => convertAIQuestion(question, preferences))
        .filter(Boolean)
        .slice(0, amount);

    if (!questions.length) {
        throw new Error(
            "Recall AI could not produce valid questions from this material. " +
            "Try another document or different question settings."
        );
    }

    return questions;
}

/* ---------- Study session ---------- */

async function startStudySession() {
    if (state.generating) return;

    const material = state.materials.find(
        (item) => item.id === $("materialSelect").value
    );

    if (!material) {
        setStudyStatus(
            "Please upload and select a study material first."
        );
        return;
    }

    const preferences = {
        questionType: $("questionType").value,
        difficulty: $("difficulty").value,
        thinkingSkill: $("thinkingSkill").value
    };

    const requestedAmount = Number($("questionAmount").value) || 10;

    const amount = Math.max(
        1,
        Math.min(requestedAmount, 50)
    );

    const startButton = $("startButton");

    state.generating = true;

    if (startButton) {
        startButton.disabled = true;
        startButton.textContent = "Generating questions...";
    }

    if ($("quizArea")) {
        $("quizArea").hidden = true;
    }

    try {
        const questions = await generateAIQuestions(
            material,
            amount,
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
            "Session ready: " + questions.length +
            " AI-generated questions."
        );

        renderQuestion();

        $("quizArea").scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    } catch (error) {
        console.error("Recall AI error:", error);

        setStudyStatus(error.message);

        if ($("quizArea")) {
            $("quizArea").hidden = true;
        }
    } finally {
        state.generating = false;

        if (startButton) {
            startButton.disabled = false;
            startButton.textContent = "Start studying";
        }
    }
}

/* ---------- Quiz rendering ---------- */

function renderQuestion() {
    const quiz = state.quiz;

    if (!quiz) return;

    const index = state.currentQuestion;
    const question = quiz.questions[index];
    const chosen = state.answers[index];
    const revealed = state.revealed[index];

    const written = [
        "shortanswer",
        "fillblank"
    ].includes(question.type);

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

            if (chosen === optionIndex) {
                classes += " selected";
            }

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
        const correct = !written && chosen === question.answer;

        feedbackHTML = `
            <div class="answer-feedback ${
                written || correct
                    ? "correct-feedback"
                    : "incorrect-feedback"
            }">

                <strong>${
                    written
                        ? "Suggested answer"
                        : correct
                            ? "Correct!"
                            : "Review this answer."
                }</strong>

                <p>${escapeHTML(question.options[question.answer])}</p>

                <p>${escapeHTML(question.explanation)}</p>

                ${
                    question.source
                        ? `<p><strong>Source:</strong> ${
                            escapeHTML(question.source)
                        }</p>`
                        : ""
                }
            </div>
        `;
    }

    const controlsHTML = revealed
        ? `<button class="primary-button" id="nextButton" type="button">
            ${
                index === quiz.questions.length - 1
                    ? "Finish session"
                    : "Next question →"
            }
           </button>`
        : `<button class="primary-button" id="revealButton" type="button"
            ${chosen === null ? "disabled" : ""}>
            Check answer
           </button>`;

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
            <div class="eyebrow">
                ${escapeHTML(question.type.toUpperCase())}
            </div>

            <h3>${escapeHTML(question.question)}</h3>

            <div class="answer-options">
                ${optionsHTML}
            </div>

            ${feedbackHTML}

            <div class="quiz-controls">
                ${controlsHTML}
            </div>
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

            if (button) {
                button.disabled = !writtenInput.value.trim();
            }
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

    const answered = state.answers.filter(
        (answer) => answer !== null
    ).length;

    const record = {
        id: makeId(),
        materialName: quiz.materialName,
        date: new Date().toISOString(),
        total,
        answered,
        correct,
        gradable: gradable.length,
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

        setStudyStatus(
            "Choose your settings and start another session."
        );
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
                        ${record.correct}/${
                            record.gradable ?? record.total
                        } correct
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

    const totalGradable = state.history.reduce(
        (sum, record) =>
            sum + (record.gradable ?? record.total),
        0
    );

    const correct = state.history.reduce(
        (sum, record) => sum + record.correct,
        0
    );

    if ($("accuracy")) {
        $("accuracy").textContent = (
            totalGradable
                ? Math.round(correct / totalGradable * 100)
                : 0
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
