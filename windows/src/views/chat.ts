// Chat view — DOM port of PromptView / ChatBubble / TypingDotsView from
// IslandViewContent.swift.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { Bridge, type ChatContext } from "../core/bridge";
import { Sound } from "../core/sound";
import { t } from "../core/i18n";
import { pullGrip } from "./grip";
import { State, type ChatMessage } from "../core/state";
import type { ViewHost } from "./views";

let nextId = 1;

function bubble(message: ChatMessage): HTMLElement {
  if (message.role === "user") {
    return h(
      "div",
      { class: "chat-row user" },
      h("div", { class: "bubble", text: message.content }),
    );
  }
  return h("div", { class: "chat-row" }, h("div", { class: "reply", text: message.content }));
}

function typingDots(): HTMLElement {
  return h(
    "div",
    { class: "chat-row" },
    h("div", { class: "typing" }, h("i"), h("i"), h("i")),
  );
}

/** The coloured chip showing what the question is about (a dropped file). */
function contextChip(label: string, path: string, setExtra: (px: number) => void, openLarge: (url: string) => void): HTMLElement {
  const dot = h("i", { class: "chip-dot" });
  const chip = h("div", { class: "chip", title: t("chat.removeFile") }, dot, h("span", { text: label }), h("b", { class: "chip-x", text: "×" }));
  // Once a question has been sent, the file belongs to the conversation: it can still be looked at,
  // but no longer taken away.
  const locked = () => State.chatHistory.length > 0;
  const remove = () => {
    if (locked()) return;
    State.droppedFile = null;
    State.promptContext = null;
    State.notify();
  };
  // A click takes a plain file away (the question is then about nothing in particular).
  chip.addEventListener("click", () => {
    if (!chip.classList.contains("thumb-big")) remove();
  });
  const PREVIEW_EXTRA = 60;
  // A picture gets a small preview in place of the colour dot.
  if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(label)) {
    void Bridge.imagePreview(path).then((url) => {
      if (!url) return;
      // The picture, larger, with the name small over its lower edge and a × over its corner.
      clear(chip);
      chip.classList.add("thumb-big");
      chip.append(
        h("img", { class: "chip-pic", src: url, alt: "", draggable: "false" }),
        h("span", { class: "chip-cap", text: label }),
        h("b", { class: "chip-x", text: "×" }),
      );
      setExtra(PREVIEW_EXTRA);

      // The picture: a click opens it large, the × or a drag to either side takes it away.
      chip.title = "";
      // Grabbing the picture moves the chip (and throws it off); it must never start the
      // browser's own picture drag, which the island would take for a file being dropped.
      chip.addEventListener("dragstart", (e) => e.preventDefault());
      chip.querySelector(".chip-x")!.addEventListener("click", (e) => {
        e.stopPropagation();
        remove();
      });
      chip.addEventListener("mousedown", (e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest(".chip-x")) return;
        const startX = e.clientX;
        let dx = 0;
        chip.style.transition = "none";
        const move = (m: MouseEvent) => {
          if (locked()) return;
          dx = m.clientX - startX;
          chip.style.transform = `translateX(${dx}px)`;
          chip.style.opacity = String(1 - Math.min(0.8, Math.abs(dx) / 220));
        };
        const up = () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
          chip.style.transition = "transform 0.18s ease-out, opacity 0.18s ease-out";
          if (Math.abs(dx) >= 70 && !locked()) {
            // Thrown off to the side it was dragged to.
            chip.style.transform = `translateX(${dx < 0 ? -320 : 320}px)`;
            chip.style.opacity = "0";
            window.setTimeout(remove, 170);
          } else {
            chip.style.transform = "";
            chip.style.opacity = "";
            if (Math.abs(dx) < 5) openLarge(url);
          }
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      });
    });
  }
  requestAnimationFrame(() => chip.classList.add("settled"));
  return chip;
}

export function buildPrompt(onHeightChange: () => void): ViewHost {
  const chipRow = h("div", { class: "chip-row" });
  const log = h("div", { class: "chat-log" });
  const input = h("input", {
    type: "text",
    class: "chat-input",
    placeholder: t("chat.placeholder"),
    spellcheck: "false",
  }) as HTMLInputElement;
  const send = h("button", { class: "send-btn", title: t("chat.send") }, svg(ICONS.arrowUp, 11));
  const bar = h("div", { class: "chat-bar" }, input, send);

  // The dropped picture, large, over the chat. A click anywhere closes it.
  const lightbox = h("div", { class: "lightbox" });
  lightbox.style.display = "none";
  const island = () => document.getElementById("island");
  const closeLarge = () => {
    lightbox.style.display = "none";
    clear(lightbox);
    island()?.classList.remove("lightbox-open");
    State.promptExtra = State.droppedFile ? 60 : 0;
    onHeightChange();
  };
  lightbox.addEventListener("click", closeLarge);
  // Esc closes the large view first (not the island).
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lightbox.style.display !== "none") {
      e.stopImmediatePropagation();
      closeLarge();
    }
  }, true);
  const openLarge = (url: string) => {
    clear(lightbox);
    lightbox.append(
      h("img", { class: "lightbox-img", src: url, alt: "", draggable: "false" }),
    );
    lightbox.style.display = "flex";
    // Mochi stays out of the way of the picture.
    island()?.classList.add("lightbox-open");
    State.promptExtra = 200;
    onHeightChange();
  };

  const el = h(
    "div",
    { class: "view" },
    h("div", { class: "card wash chat-card" }, h("div", { class: "chat-body" }, chipRow, log, bar), lightbox),
    pullGrip(),
  );
  (el.querySelector(".card") as HTMLElement).style.setProperty("--wash", "rgba(99,102,241,0.5)");

  let sending = false;
  let renderedCount = -1;

  async function submit() {
    const query = input.value.trim();
    if (!query || sending) return;
    input.value = "";
    sending = true;
    Sound.play("send");

    State.chatHistory.push({ id: nextId++, role: "user", content: query });
    State.stateOverride = "thinking";
    State.notify();
    onHeightChange();

    const file = State.droppedFile;
    const context: ChatContext | null =
      State.chatHistory.length === 1 && file ? { kind: "file", name: file.name, path: file.path } : null;

    try {
      const reply = await Bridge.chatSend(query, context);
      State.chatHistory.push({ id: nextId++, role: "assistant", content: reply.text });
      State.stateOverride = null;
      Sound.play("finish");
    } catch (err) {
      State.stateOverride = null;
      State.noteMessage = String(err).replace(/^Error:\s*/, "");
      State.view = "note";
      Sound.play("error");
    } finally {
      sending = false;
      State.notify();
      onHeightChange();
      input.focus();
    }
  }

  send.addEventListener("click", () => void submit());
  input.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      e.preventDefault();
      void submit();
    }
    e.stopPropagation(); // Escape closes the island, not the chat
  });

  return {
    el,
    sync() {
      const file = State.droppedFile;
      // After the first question the picture is part of the conversation: no × and no dragging it away.
      const chipEl = chipRow.firstElementChild as HTMLElement | null;
      if (chipEl) {
        const sent = State.chatHistory.length > 0;
        chipEl.classList.toggle("locked", sent);
        // The "remove" hint only while it can be removed (a picture's title is empty anyway).
        if (sent) chipEl.title = "";
        else if (!chipEl.classList.contains("thumb-big")) chipEl.title = t("chat.removeFile");
      }
      const wantChip = file ? `${file.name}|${file.path}` : "";
      if (chipRow.dataset.label !== wantChip) {
        chipRow.dataset.label = wantChip;
        clear(chipRow);
        if (State.promptExtra) {
          State.promptExtra = 0;
          onHeightChange();
        }
        if (file) {
          chipRow.append(contextChip(file.name, file.path, (px) => {
            State.promptExtra = px;
            onHeightChange();
          }, openLarge));
        }
      }

      const thinking = State.stateOverride === "thinking";
      const count = State.chatHistory.length + (thinking ? 0.5 : 0);
      if (count !== renderedCount) {
        renderedCount = count;
        clear(log);
        for (const m of State.chatHistory) log.append(bubble(m));
        if (thinking) log.append(typingDots());
        log.scrollTop = log.scrollHeight;
      }

      input.placeholder = State.chatHistory.length === 0 ? t("chat.placeholder") : t("chat.continue");
      input.disabled = sending;
    },
    focus() {
      input.focus();
      input.select();
    },
  };
}
