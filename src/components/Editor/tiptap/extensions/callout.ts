/**
 * Callout 块扩展 — GitHub / Obsidian 风格提示块
 *
 * 支持类型：note, tip, warning, danger, important, info, success, caution
 * 语法：> [!TYPE]
 *
 * 作为 TipTap Node 扩展实现，内含 block 内容。
 */
import { Node, mergeAttributes } from '@tiptap/core';

export const CALLOUT_TYPES = [
  'note', 'tip', 'warning', 'danger', 'important', 'info', 'success', 'caution',
] as const;

export type CalloutType = typeof CALLOUT_TYPES[number];

const CALLOUT_ICONS: Record<CalloutType, string> = {
  note: '\u2139\uFE0F',
  info: '\u2139\uFE0F',
  tip: '\uD83D\uDCA1',
  warning: '\u26A0\uFE0F',
  caution: '\u26A0\uFE0F',
  danger: '\uD83D\uDD25',
  important: '\u2757',
  success: '\u2705',
};

const CALLOUT_LABELS: Record<CalloutType, string> = {
  note: 'Note',
  info: 'Info',
  tip: 'Tip',
  warning: 'Warning',
  caution: 'Caution',
  danger: 'Danger',
  important: 'Important',
  success: 'Success',
};

export function normalizeCalloutType(type: string | null | undefined): CalloutType {
  const normalized = (type || '').trim().toLowerCase();
  if (CALLOUT_TYPES.includes(normalized as CalloutType)) {
    return normalized as CalloutType;
  }
  return 'note';
}

export const Callout = Node.create({
  name: 'callout',

  group: 'block',

  content: 'block+',

  defining: true,

  addAttributes() {
    return {
      calloutType: {
        default: 'note',
        parseHTML: (element) => {
          const cls = element.getAttribute('class') || '';
          for (const t of CALLOUT_TYPES) {
            if (cls.includes(`mk-callout-${t}`)) return t;
          }
          return 'note';
        },
        renderHTML: (attributes) => {
          const type = normalizeCalloutType(attributes.calloutType);
          return {
            class: `mk-callout mk-callout-${type}`,
            'data-callout-type': type,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div.mk-callout',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes),
      [
        'div',
        { class: 'mk-callout-title' },
        [
          'span',
          { class: 'mk-callout-icon' },
          CALLOUT_ICONS[normalizeCalloutType(HTMLAttributes.class?.match(/mk-callout-(\w+)/)?.[1]) || 'note'],
        ],
        CALLOUT_LABELS[normalizeCalloutType(HTMLAttributes.class?.match(/mk-callout-(\w+)/)?.[1]) || 'note'],
      ],
      ['div', { class: 'mk-callout-body' }, 0],
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const type = normalizeCalloutType(node.attrs.calloutType);
      
      const dom = document.createElement('div');
      dom.className = `mk-callout mk-callout-${type}`;
      dom.setAttribute('data-callout-type', type);
      
      const title = document.createElement('div');
      title.className = 'mk-callout-title';
      
      const icon = document.createElement('span');
      icon.className = 'mk-callout-icon';
      icon.textContent = CALLOUT_ICONS[type];
      title.appendChild(icon);
      
      const label = document.createTextNode(CALLOUT_LABELS[type]);
      title.appendChild(label);
      
      dom.appendChild(title);
      
      const body = document.createElement('div');
      body.className = 'mk-callout-body';
      dom.appendChild(body);
      
      return {
        dom,
        contentDOM: body,
      };
    };
  },
});
