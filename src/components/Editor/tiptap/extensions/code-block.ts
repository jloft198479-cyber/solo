/**
 * 代码块扩展 — 基于 CodeBlockLowlight
 *
 * 特性：
 * - 语法高亮（lowlight + highlight.js）
 * - 直接在渲染态编辑代码
 * - 支持语言标识
 */
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { createLowlight } from 'lowlight';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import css from 'highlight.js/lib/languages/css';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import diff from 'highlight.js/lib/languages/diff';

const lowlight = createLowlight({
  javascript,
  typescript,
  python,
  bash,
  json,
  markdown,
  xml,
  yaml,
  sql,
  css,
  rust,
  go,
  java,
  cpp,
  php,
  ruby,
  diff,
});

export function normalizeCodeBlockLanguage(language: string | null | undefined): string | null {
  const normalized = language?.trim().toLowerCase() ?? '';
  return normalized || null;
}

export function getCodeBlockLanguageLabel(language: string | null | undefined): string {
  return normalizeCodeBlockLanguage(language) || 'plain text';
}

function updateCodeBlockLanguage(
  editor: Editor,
  node: PMNode,
  getPos: (() => number | undefined) | boolean,
  language: string | null,
) {
  if (typeof getPos !== 'function') return;

  const pos = getPos();
  if (typeof pos !== 'number') return;
  const tr = editor.view.state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    language,
  });
  editor.view.dispatch(tr);
}

export const CustomCodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    const parent = this.parent?.() ?? {};

    return {
      ...parent,
      languageLabel: {
        default: null,
        parseHTML: () => null,
        renderHTML: (attributes) => ({
          'data-language': getCodeBlockLanguageLabel(
            typeof attributes.language === 'string' ? attributes.language : null,
          ),
        }),
      },
    };
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'mk-code-block-shell';

      const header = document.createElement('div');
      header.className = 'mk-code-block-header';
      dom.appendChild(header);

      const languageButton = document.createElement('button');
      languageButton.type = 'button';
      languageButton.className = 'mk-code-block-language-button';
      header.appendChild(languageButton);

      const languageInput = document.createElement('input');
      languageInput.className = 'mk-code-block-language-input';
      languageInput.placeholder = '输入语言';
      languageInput.style.display = 'none';
      header.appendChild(languageInput);

      // 复制按钮
      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.className = 'mk-code-block-copy-button';
      copyButton.title = '复制代码';
      copyButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      header.appendChild(copyButton);

      let copyTimeout: ReturnType<typeof setTimeout> | null = null;
      copyButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const code = node.textContent;
        navigator.clipboard.writeText(code).then(() => {
          copyButton.classList.add('is-copied');
          copyButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
          if (copyTimeout) clearTimeout(copyTimeout);
          copyTimeout = setTimeout(() => {
            copyButton.classList.remove('is-copied');
            copyButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
          }, 2000);
        });
      });

      const pre = document.createElement('pre');
      pre.className = 'mk-code-block';
      dom.appendChild(pre);

      const code = document.createElement('code');
      pre.appendChild(code);

      let isEditingLanguage = false;

      function syncLanguageUI() {
        if (isEditingLanguage) return;
        const currentLanguage = typeof node.attrs.language === 'string' ? node.attrs.language : null;
        const label = getCodeBlockLanguageLabel(currentLanguage);
        languageButton.textContent = label;
        pre.dataset.language = label;
      }

      function enterLanguageEdit() {
        if (isEditingLanguage) return;
        isEditingLanguage = true;
        languageButton.style.display = 'none';
        languageInput.style.display = 'block';
        languageInput.value = typeof node.attrs.language === 'string' ? node.attrs.language : '';
        languageInput.focus();
        languageInput.select();
      }

      function exitLanguageEdit() {
        isEditingLanguage = false;
        languageInput.style.display = 'none';
        languageButton.style.display = 'inline-flex';
        syncLanguageUI();
      }

      function commitLanguage() {
        const nextLanguage = normalizeCodeBlockLanguage(languageInput.value);
        const currentLanguage = normalizeCodeBlockLanguage(
          typeof node.attrs.language === 'string' ? node.attrs.language : null,
        );

        exitLanguageEdit();

        if (nextLanguage === currentLanguage) return;
        updateCodeBlockLanguage(editor, node, getPos, nextLanguage);
      }

      function cancelLanguageEdit() {
        exitLanguageEdit();
      }

      languageButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        enterLanguageEdit();
      });

      languageInput.addEventListener('blur', () => {
        commitLanguage();
      });

      languageInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commitLanguage();
          editor.commands.focus();
          return;
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          cancelLanguageEdit();
          editor.commands.focus();
        }
      });

      syncLanguageUI();

      return {
        dom,
        contentDOM: code,
        update(updatedNode: PMNode) {
          if (updatedNode.type.name !== 'codeBlock') return false;
          node = updatedNode;
          syncLanguageUI();
          return true;
        },
        stopEvent(event: Event) {
          return event.target instanceof Node && header.contains(event.target);
        },
        ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }) {
          return mutation.target instanceof Node && header.contains(mutation.target);
        },
      };
    };
  },
}).configure({
  lowlight,
  defaultLanguage: null,
  HTMLAttributes: {
    class: 'mk-code-block',
  },
});
