"use strict";

/* ==========================================
   RECALL — STUDY APPLICATION
   Frontend functionality
   ========================================== */

const $ = (id) => document.getElementById(id);

const STORAGE_KEY = "recall_study_v1";

const state = {
    materials: [],
    questionBank: {},
    history: [],
    quiz: null,
    currentQuestion: 0,
    answers: [],
    revealed: [],
    mode: "practice"
};

const LETTERS = ["A", "B", "C", "D"];

/* ---------- Persistent local storage ---------- */

function loadState() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));

        if (saved && typeof saved === "object") {
            state.materials = Array.isArray(saved.materials)
                ? saved.materials
                : [];

            state.questionBank =
                saved.questionBank &&
                typeof saved.questionBank === "object"
                    ? saved.questionBank
                    : {};

            state.history = Array.isArray(saved.history)
                ? saved.history
                : [];
        }
    } catch (error) {
        console.error("Could not load Recall data:", error);
    }
}

function saveState() {
    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                materials: state.materials,
                questionBank: state.questionBank,
                history: state.history
            })
        );

        return true;
    } catch (error) {
        console.error("Could not save Recall data:", error);

        setUploadStatus(
            "Storage is full or unavailable. Try removing a large material."
        );

        return false;
    }
}

/* ---------- Utilities ---------- */

function makeId() {
    if (window.crypto && crypto.randomUUID) {
        return crypto.randomUUID();
    }

    return Date.now().toString(36) +
        Math.random().toString(36).slice(2);
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => {
        const replacements = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        };

        return replacements[character];
    });
}

function formatDate(value) {
    return new Date(value).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric"
    });
}

function setUploadStatus(message) {
    $("uploadStatus").textContent = message;
}

function setStudyStatus(message) {
    $("studyStatus").textContent = message;
}

function wordCount(text) {
    return text.trim()
        ? text.trim().split(/\s+/).length
        : 0;
}

/* ---------- Document extraction ---------- */

async function extractFileText(file) {
    const name = file.name.toLowerCase();

    if (name.endsWith(".txt") ||
        name.endsWith(".md") ||
        name.endsWith(".markdown")) {
        return await file.text();
    }

    if (name.endsWith(".pdf")) {
        if (!window.pdfjsLib) {
            throw new Error(
                "The PDF reader did not load. Check your internet connection."
            );
        }

        pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

        const buffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({
            data: buffer
        }).promise;

        const pages = [];

        for (let pageNumber = 1;
             pageNumber <= pdf.numPages;
             pageNumber++) {

            const page = await pdf.getPage(pageNumber);
            const content = await page.getTextContent();

            pages.push(
                content.items
                    .map((item) => item.str || "")
                    .join(" ")
            );
        }

        return pages.join("\n\n");
    }

    if (name.endsWith(".docx")) {
        if (!window.mammoth) {
            throw new Error(
                "The DOCX reader did not load. Check your internet connection."
            );
        }

        const buffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({
            arrayBuffer: buffer
        });

        return result.value;
    }

    throw new Error("Unsupported file type: " + file.name);
}

/* ---------- File upload ---------- */

async function handleFileUpload(event) {
    const files = Array.from(event.target.files || []);

    if (!files.length) {
        return;
    }

    for (const file of files) {
        const supported =
            /\.(pdf|docx|txt|md|markdown)$/i.test(file.name);

        if (!supported) {
            setUploadStatus(
                "Unsupported file: " + file.name
            );
            continue;
        }

        setUploadStatus("Reading " + file.name + "...");

        try {
            const text = await extractFileText(file);

            if (!text.trim()) {
                setUploadStatus(
                    file.name +
                    " contains no extractable text. Scanned PDFs may need OCR."
                );
                continue;
            }

            const material = {
                id: makeId(),
                name: file.name,
                text: text.slice(0, 250000),
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
                "Successfully added " + file.name +
                " (" + material.words.toLocaleString() +
                " words)."
            );
        } catch (error) {
            console.error(error);

            setUploadStatus(
                "Could not read " + file.name + ": " +
                error.message
            );
        }
    }

    event.target.value = "";
}

/* ---------- Study library ---------- */

function renderLibrary() {
    const library = $("library");
    const select = $("materialSelect");

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
                <span class="item-icon" aria-hidden="true">PDF</span>
                <div class="item-details">
                    <strong>${escapeHTML(material.name)}</strong>
                    <span>
                        ${material.words.toLocaleString()} words ·
                        Added ${formatDate(material.addedAt)}
                    </span>
                </div>
            </div>

            <div class="item-actions">
                <button
                    class="small-button"
                    type="button"
                    data-action="study"
                    data-id="${escapeHTML(material.id)}"
                >Study</button>

                <button
                    class="small-button danger"
                    type="button"
                    data-action="delete"
                    data-id="${escapeHTML(material.id)}"
                >Delete</button>
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

function deleteMaterial(id) {
    const material = state.materials.find(
        (item) => item.id === id
    );

    if (!material) {
        return;
    }

    if (!confirm('Delete "' + material.name + '" and its saved questions?')) {
        return;
    }

    state.materials = state.materials.filter(
        (item) => item.id !== id
    );

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
    const button = event.target.closest("button[data-action]");

    if (!button) {
        return;
    }

    const id = button.dataset.id;
    const action = button.dataset.action;

    if (action === "delete") {
        deleteMaterial(id);
    }

    if (action === "study") {
        $("materialSelect").value = id;
        startStudySession();
        $("quizArea").scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
}

/* ---------- Basic local question generation ---------- */

/*
 * This is a lightweight fallback, not AI.
 * It turns useful sentences from notes into simple questions.
 * Layer 4 will add a secure AI backend.
 */

function splitSentences(text) {
    return text
        .replace(/\r/g, "\n")
        .split(/(?<=[.!?])\s+|\n+/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => {
            const words = wordCount(sentence);

            return words >= 7 &&
                words <= 45 &&
                /[a-zA-Z]/.test(sentence);
        });
}

function makeOptions(correct, candidates) {
    const distractors = [...new Set(
        candidates.filter((candidate) =>
            candidate.toLowerCase() !== correct.toLowerCase()
        )
    )].slice(0, 3);

    const options = [correct, ...distractors];

    while (options.length < 4) {
        options.push(
            "None of the other statements"
        );
    }

    for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [options[i], options[j]] = [options[j], options[i]];
    }

    return {
        options,
        answer: options.indexOf(correct)
    };
}

function generateLocalQuestions(material, amount) {
    const sentences = splitSentences(material.text);

    if (sentences.length < 2) {
        throw new Error(
            "There is not enough readable text to create questions. " +
            "Try a longer document or upload text-based notes."
        );
    }

    const shuffled = [...sentences].sort(
        () => Math.random() - 0.5
    );

    const questions = [];
    const used = new Set();

    for (const sentence of shuffled) {
        if (questions.length >= amount) {
            break;
        }

        if (used.has(sentence)) {
            continue;
        }

        used.add(sentence);

        const words = sentence.split(/\s+/);
        const correct = sentence;
        const candidates = shuffled.filter(
            (candidate) => candidate !== sentence
        );

        const generated = makeOptions(
            correct,
            candidates
        );

        questions.push({
            id: makeId(),
            type: "mcq",
            question:
                "Which statement is taken from your study material?",
            options: generated.options,
            answer: generated.answer,
            explanation:
                "This statement appears in your uploaded notes. " +
                "Review the surrounding section to understand its context.",
            source: sentence
        });
    }

    if (!questions.length) {
        throw new Error(
            "Could not generate questions from this document."
        );
    }

    return questions;
}

/* ---------- Question bank ---------- */

function getQuestions(material, amount) {
    const saved = state.questionBank[material.id] || [];

    if (saved.length >= amount) {
        return saved.slice(0, amount);
    }

    const newQuestions = generateLocalQuestions(
        material,
        amount - saved.length
    );

    const combined = [...saved, ...newQuestions];

    state.questionBank[material.id] = combined;

    saveState();

    return combined.slice(0, amount);
}

/* ---------- Quiz session ---------- */

function startStudySession() {
    const materialId = $("materialSelect").value;

    const material = state.materials.find(
        (item) => item.id === materialId
    );

    if (!material) {
        setStudyStatus(
            "Please upload and select a study material first."
        );
        return;
    }

    const amount = Number($("questionAmount").value);
    const mode = $("studyMode").value;

    try {
        const questions = getQuestions(
            material,
            amount
        );

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
            " questions. Mode: " +
            (mode === "exam" ? "Exam" : "Practice") + "."
        );

        renderQuestion();
    } catch (error) {
        console.error(error);
        setStudyStatus(error.message);
    }
}

function renderQuestion() {
    const quiz = state.quiz;

    if (!quiz) {
        return;
    }

    const index = state.currentQuestion;
    const question = quiz.questions[index];
    const chosen = state.answers[index];
    const revealed = state.revealed[index];

    const answeredCount = state.answers.filter(
        (answer) => answer !== null
    ).length;

    const percentage = ((index + 1) / quiz.questions.length) * 100;

    let optionsHTML = question.options.map((option, optionIndex) => {
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

        const disabled =
            revealed ||
            (state.mode === "exam" && chosen !== null);

        return `
            <button
                type="button"
                class="${classes}"
                data-option="${optionIndex}"
                ${disabled ? "disabled" : ""}
            >
                <span class="option-letter">
                    ${LETTERS[optionIndex]}
                </span>
                <span>${escapeHTML(option)}</span>
            </button>
        `;
    }).join("");

    let feedbackHTML = "";

    if (revealed) {
        const correct = chosen === question.answer;

        feedbackHTML = `
            <div class="answer-feedback ${
                correct ? "correct-feedback" : "incorrect-feedback"
            }">
                <strong>
                    ${correct ? "Correct!" : "Not quite."}
                </strong>
                <p>
                    Correct answer:
                    ${LETTERS[question.answer]}.
                    ${escapeHTML(question.options[question.answer])}
                </p>
                <p>${escapeHTML(question.explanation)}</p>
            </div>
        `;
    }

    let controlsHTML = "";

    if (state.mode === "practice") {
        if (!revealed) {
            controlsHTML = `
                <button
                    class="primary-button"
                    id="revealButton"
                    type="button"
                    ${chosen === null ? "disabled" : ""}
                >Check answer</button>
            `;
        } else {
            controlsHTML = `
                <button
                    class="primary-button"
                    id="nextButton"
                    type="button"
                >
                    ${index === quiz.questions.length - 1
                        ? "Finish session"
                        : "Next question →"}
                </button>
            `;
        }
    } else {
        if (chosen === null) {
            controlsHTML = `
                <button
                    class="primary-button"
                    id="examNextButton"
                    type="button"
                    disabled
                >${index === quiz.questions.length - 1
                    ? "Finish exam"
                    : "Next question →"}</button>
            `;
        } else {
            controlsHTML = `
                <button
                    class="primary-button"
                    id="examNextButton"
                    type="button"
                >${index === quiz.questions.length - 1
                    ? "Finish exam"
                    : "Next question →"}</button>
            `;
        }
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
            <div class="eyebrow">QUESTION ${index + 1}</div>
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

    $("quizArea").querySelectorAll("[data-option]").forEach(
        (button) => {
            button.addEventListener("click", () => {
                selectAnswer(Number(button.dataset.option));
            });
        }
    );

    const revealButton = $("revealButton");
    if (revealButton) {
        revealButton.addEventListener("click", revealAnswer);
    }

    const nextButton = $("nextButton");
    if (nextButton) {
        nextButton.addEventListener("click", nextQuestion);
    }

    const examNextButton = $("examNextButton");
    if (examNextButton) {
        examNextButton.addEventListener("click", () => {
            if (state.answers[index] === null) {
                return;
            }

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
    if (!state.quiz) {
        return;
    }

    const index = state.currentQuestion;

    if (state.revealed[index]) {
        return;
    }

    if (state.mode === "exam" &&
        state.answers[index] !== null) {
        return;
    }

    state.answers[index] = optionIndex;
    renderQuestion();
}

function revealAnswer() {
    if (!state.quiz) {
        return;
    }

    const index = state.currentQuestion;

    if (state.answers[index] === null) {
        return;
    }

    state.revealed[index] = true;
    renderQuestion();
}

function nextQuestion() {
    if (!state.quiz) {
        return;
    }

    if (state.currentQuestion <
        state.quiz.questions.length - 1) {

        state.currentQuestion++;
        renderQuestion();
    } else {
        finishSession();
    }
}

/* ---------- Results and history ---------- */

function finishSession() {
    const quiz = state.quiz;

    if (!quiz) {
        return;
    }

    const total = quiz.questions.length;

    const correct = state.answers.reduce(
        (count, answer, index) => {
            return count +
                (answer === quiz.questions[index].answer ? 1 : 0);
        },
        0
    );

    const answered = state.answers.filter(
        (answer) => answer !== null
    ).length;

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
            explanation: question.explanation
        }))
    };

    state.history.unshift(record);

    state.history = state.history.slice(0, 100);

    saveState();

    renderHistory();
    renderStats();

    const incorrect = total - correct;

    $("quizArea").innerHTML = `
        <div class="question-card">
            <div class="eyebrow">SESSION COMPLETE</div>
            <h2>Your results</h2>

            <div class="result-score">
                ${record.accuracy}%
            </div>

            <p class="result-message">
                You answered ${correct} out of ${total} questions correctly.
                ${answered < total
                    ? "You left " + (total - answered) +
                      " question(s) unanswered."
                    : ""}
            </p>

            <p class="result-message">
                ${incorrect > 0
                    ? incorrect + " question(s) need more revision."
                    : "Excellent work — you answered every question correctly!"}
            </p>

            <div class="quiz-controls">
                <button
                    class="secondary-button"
                    id="reviewButton"
                    type="button"
                >Review answers</button>

                <button
                    class="primary-button"
                    id="restartButton"
                    type="button"
                >New session</button>
            </div>
        </div>
    `;

    $("reviewButton").addEventListener("click", () => {
        showReview(record);
    });

    $("restartButton").addEventListener("click", () => {
        $("quizArea").hidden = true;
        setStudyStatus(
            "Choose your settings and start another session."
        );
    });

    setStudyStatus("Session completed and saved.");
}

function showReview(record) {
    $("quizArea").innerHTML = `
        <div class="section-heading">
            <div>
                <div class="eyebrow">ANSWER REVIEW</div>
                <h2>Review your answers</h2>
                <p>${escapeHTML(record.materialName)}</p>
            </div>
        </div>

        ${record.questions.map((question, index) => {
            const isCorrect =
                question.selected === question.answer;

            return `
                <article class="question-card" style="margin-bottom:14px">
                    <h3>${index + 1}. ${escapeHTML(question.question)}</h3>

                    <p>
                        <strong>Your answer:</strong>
                        ${question.selected === null
                            ? "Unanswered"
                            : escapeHTML(
                                question.options[question.selected]
                            )}
                    </p>

                    <p>
                        <strong>Correct answer:</strong>
                        ${escapeHTML(
                            question.options[question.answer]
                        )}
                    </p>

                    <p>
                        <strong>Result:</strong>
                        ${isCorrect ? "Correct" : "Incorrect"}
                    </p>

                    <p>${escapeHTML(question.explanation)}</p>
                </article>
            `;
        }).join("")}

        <button
            class="primary-button"
            id="backToResults"
            type="button"
        >Back to results</button>
    `;

    $("backToResults").addEventListener("click", () => {
        renderHistory();
        $("quizArea").innerHTML = `
            <div class="question-card">
                <h2>Review completed</h2>
                <p>Your session remains saved in your history.</p>
            </div>
        `;
    });
}

function renderHistory() {
    const history = $("history");

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
                        ${record.correct}/${record.total} correct ·
                        ${escapeHTML(record.mode)}
                    </span>
                </div>
            </div>

            <strong>${record.accuracy}%</strong>
        </article>
    `).join("");
}

/* ---------- Dashboard statistics ---------- */

function renderStats() {
    $("materialCount").textContent =
        state.materials.length;

    const answered = state.history.reduce(
        (total, record) => total + record.answered,
        0
    );

    $("questionCount").textContent = answered;

    const totalQuestions = state.history.reduce(
        (total, record) => total + record.total,
        0
    );

    const totalCorrect = state.history.reduce(
        (total, record) => total + record.correct,
        0
    );

    const accuracy = totalQuestions
        ? Math.round((totalCorrect / totalQuestions) * 100)
        : 0;

    $("accuracy").textContent = accuracy + "%";
}

/* ---------- Application startup ---------- */

function initializeRecall() {
    loadState();

    renderLibrary();
    renderHistory();
    renderStats();

    $("fileInput").addEventListener(
        "change",
        handleFileUpload
    );

    $("library").addEventListener(
        "click",
        handleLibraryClick
    );

    $("startButton").addEventListener(
        "click",
        startStudySession
    );

    setStudyStatus(
        "Upload your notes, select a material, and start studying."
    );
}

document.addEventListener(
    "DOMContentLoaded",
    initializeRecall
);
