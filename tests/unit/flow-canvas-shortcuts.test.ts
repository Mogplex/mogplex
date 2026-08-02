import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { shouldIgnoreCanvasShortcut } from "../../lib/flows/canvas-shortcuts";

test("canvas shortcuts conservatively ignore declared text entry but not a closed select trigger", () => {
  const dom = new JSDOM(`
    <input id="input" />
    <div id="editor" contenteditable="true"></div>
    <div id="plaintext-editor" contenteditable="plaintext-only"></div>
    <div id="unknown-editor" contenteditable="invalid"></div>
    <div id="disabled-editor" contenteditable="false"></div>
    <div id="uppercase-disabled-editor" contenteditable="FALSE"></div>
    <button id="trigger" role="combobox" aria-expanded="false"></button>
  `);
  const document = dom.window.document;

  for (const id of ["input", "editor", "plaintext-editor", "unknown-editor"]) {
    const element = document.querySelector(`#${id}`);
    assert.equal(shouldIgnoreCanvasShortcut(element, element, document), true);
  }

  const input = document.querySelector("#input");
  assert.equal(
    shouldIgnoreCanvasShortcut(input, document.body, document),
    true
  );
  assert.equal(
    shouldIgnoreCanvasShortcut(document.body, input, document),
    true
  );

  const trigger = document.querySelector("#trigger");
  assert.equal(shouldIgnoreCanvasShortcut(trigger, trigger, document), false);
  const disabledEditor = document.querySelector("#disabled-editor");
  assert.equal(
    shouldIgnoreCanvasShortcut(disabledEditor, disabledEditor, document),
    false
  );
  const uppercaseDisabledEditor = document.querySelector(
    "#uppercase-disabled-editor"
  );
  assert.equal(
    shouldIgnoreCanvasShortcut(
      uppercaseDisabledEditor,
      uppercaseDisabledEditor,
      document
    ),
    false
  );
});

test("an open popup trigger owns shortcuts when focus stays on the trigger", () => {
  const dom = new JSDOM(`
    <button id="open-trigger" data-state="open" aria-haspopup="dialog">
      <span id="open-trigger-child"></span>
    </button>
    <button id="closed-trigger" data-state="closed" aria-haspopup="dialog"></button>
  `);
  const document = dom.window.document;
  const openTrigger = document.querySelector("#open-trigger");
  const openTriggerChild = document.querySelector("#open-trigger-child");
  const closedTrigger = document.querySelector("#closed-trigger");

  assert.equal(
    shouldIgnoreCanvasShortcut(openTrigger, openTrigger, document),
    true
  );
  assert.equal(
    shouldIgnoreCanvasShortcut(openTriggerChild, openTriggerChild, document),
    true
  );
  assert.equal(
    shouldIgnoreCanvasShortcut(closedTrigger, closedTrigger, document),
    false
  );
});

test("canvas shortcuts defer to keyboard-owning overlay event targets", () => {
  const dom = new JSDOM(`
    <div role="dialog"><button id="dialog-button"></button></div>
    <div role="menu"><button id="menu-button"></button></div>
    <div data-slot="command"><button id="command-button"></button></div>
    <div data-canvas-shortcuts="ignore"><button id="custom-button"></button></div>
  `);
  const document = dom.window.document;

  for (const id of [
    "dialog-button",
    "menu-button",
    "command-button",
    "custom-button",
  ]) {
    const element = document.querySelector(`#${id}`);
    assert.equal(shouldIgnoreCanvasShortcut(element, element, document), true);
  }
});

test("canvas shortcuts defer to a closing detached overlay", () => {
  const dom = new JSDOM(
    '<div data-slot="select-content"><button id="option"></button></div>'
  );
  const document = dom.window.document;
  const option = document.querySelector("#option");

  option?.parentElement?.remove();

  assert.equal(
    shouldIgnoreCanvasShortcut(document.body, option, document),
    true
  );
});

test("an unrelated open surface does not disable canvas shortcuts", () => {
  const dom = new JSDOM(`
    <div data-slot="popover-content" data-state="open"></div>
    <div data-slot="dropdown-menu-content" data-state="open"></div>
    <button id="canvas"></button>
  `);
  const document = dom.window.document;
  const canvas = document.querySelector("#canvas");

  assert.equal(shouldIgnoreCanvasShortcut(canvas, canvas, document), false);
});

test("an open modal surface owns shortcuts during focus transitions", () => {
  const dom = new JSDOM(`
    <div id="open-dialog" data-slot="dialog-content" data-state="open"></div>
    <div
      data-slot="dialog-content"
      data-state="closed"
      role="dialog"
      aria-modal="true"
    ></div>
  `);
  const document = dom.window.document;

  assert.equal(
    shouldIgnoreCanvasShortcut(document.body, document.body, document),
    true
  );

  document.querySelector("#open-dialog")?.remove();

  assert.equal(
    shouldIgnoreCanvasShortcut(document.body, document.body, document),
    false
  );
});
