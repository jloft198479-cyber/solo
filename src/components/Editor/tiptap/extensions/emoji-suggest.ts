import { Extension } from '@tiptap/vue-3';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionOptions } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';

const emojiPluginKey = new PluginKey('emojiSuggest');

export interface EmojiItem {
  emoji: string;
  name: string;
  keywords: string[];
}

type EmojiSuggestSuggestionOptions = Omit<
  SuggestionOptions<EmojiItem, EmojiItem>,
  'editor'
>;

interface EmojiSuggestOptions {
  suggestion: EmojiSuggestSuggestionOptions;
}

export const emojiItems: EmojiItem[] = [
  // 表情
  { emoji: '😊', name: 'smile', keywords: ['微笑', '开心', 'smile', 'happy'] },
  { emoji: '😄', name: 'grin', keywords: ['大笑', 'grin', 'laugh'] },
  { emoji: '😆', name: 'laughing', keywords: ['笑', '哈哈', 'laughing'] },
  { emoji: '😂', name: 'joy', keywords: ['笑哭', '笑死', 'joy', 'tears'] },
  { emoji: '🤣', name: 'rofl', keywords: ['笑翻', '笑趴', 'rofl'] },
  { emoji: '😉', name: 'wink', keywords: ['眨眼', 'wink'] },
  { emoji: '😍', name: 'heart_eyes', keywords: ['花痴', '喜欢', 'heart', 'love'] },
  { emoji: '🥰', name: 'smiling_face_with_hearts', keywords: ['爱', '喜爱', 'love'] },
  { emoji: '😘', name: 'kissing_heart', keywords: ['亲亲', '飞吻', 'kiss'] },
  { emoji: '😋', name: 'yum', keywords: ['好吃', '美味', 'yum', 'delicious'] },
  { emoji: '😜', name: 'stuck_out_tongue_winking_eye', keywords: ['调皮', '吐舌', 'playful'] },
  { emoji: '🤔', name: 'thinking', keywords: ['思考', '想', 'thinking', 'hmm'] },
  { emoji: '😏', name: 'smirk', keywords: ['坏笑', '得意', 'smirk'] },
  { emoji: '😎', name: 'sunglasses', keywords: ['酷', '墨镜', 'cool'] },
  { emoji: '🥺', name: 'pleading', keywords: ['求求', '可怜', 'pleading'] },
  { emoji: '😢', name: 'cry', keywords: ['哭', '伤心', 'cry', 'sad'] },
  { emoji: '😭', name: 'sob', keywords: ['大哭', 'sob'] },
  { emoji: '😤', name: 'triumph', keywords: ['生气', '哼', 'angry'] },
  { emoji: '😡', name: 'rage', keywords: ['愤怒', 'rage'] },
  { emoji: '😱', name: 'scream', keywords: ['惊恐', '害怕', 'scream'] },
  { emoji: '😨', name: 'fearful', keywords: ['害怕', '恐惧', 'fear'] },
  { emoji: '🤗', name: 'hugging', keywords: ['拥抱', '抱抱', 'hug'] },
  { emoji: '🤩', name: 'star_struck', keywords: ['哇', '惊艳', 'star'] },
  { emoji: '🫡', name: 'salute', keywords: ['敬礼', '收到', 'salute'] },
  { emoji: '🤫', name: 'shushing', keywords: ['嘘', '安静', 'shush'] },
  { emoji: '🤭', name: 'hand_over_mouth', keywords: ['捂嘴', '偷笑', 'oops'] },
  { emoji: '😴', name: 'sleeping', keywords: ['睡觉', '困', 'sleep', 'zzz'] },
  { emoji: '🥱', name: 'yawning', keywords: ['打哈欠', '无聊', 'yawn'] },
  { emoji: '😷', name: 'mask', keywords: ['口罩', '生病', 'mask', 'sick'] },
  { emoji: '🤒', name: 'thermometer', keywords: ['发烧', '生病', 'fever'] },
  { emoji: '🤮', name: 'vomiting', keywords: ['吐', '恶心', 'vomit'] },
  { emoji: '🤡', name: 'clown', keywords: ['小丑', 'clown'] },
  { emoji: '👻', name: 'ghost', keywords: ['鬼', '幽灵', 'ghost'] },
  { emoji: '💀', name: 'skull', keywords: ['骷髅', '死', 'skull', 'dead'] },
  // 手势
  { emoji: '👍', name: 'thumbsup', keywords: ['赞', '好', 'thumbsup', 'like'] },
  { emoji: '👎', name: 'thumbsdown', keywords: ['踩', '差', 'thumbsdown', 'dislike'] },
  { emoji: '👏', keywords: ['鼓掌', '棒', 'clap'], name: 'clap' },
  { emoji: '🙌', name: 'raised_hands', keywords: ['举手', '太棒了', 'hooray'] },
  { emoji: '🤝', name: 'handshake', keywords: ['握手', '合作', 'handshake'] },
  { emoji: '✌️', name: 'peace', keywords: ['耶', '和平', 'peace', 'victory'] },
  { emoji: '🤞', name: 'crossed_fingers', keywords: ['祈祷', '好运', 'luck'] },
  { emoji: '💪', name: 'muscle', keywords: ['加油', '力量', 'strong', 'muscle'] },
  { emoji: '🙏', name: 'pray', keywords: ['祈祷', '感谢', 'pray', 'thanks'] },
  { emoji: '👋', name: 'wave', keywords: ['你好', '再见', 'wave', 'hello'] },
  // 心形
  { emoji: '❤️', name: 'heart', keywords: ['心', '爱', 'heart', 'love', '红心'] },
  { emoji: '🧡', name: 'orange_heart', keywords: ['橙心', 'orange', 'heart'] },
  { emoji: '💛', name: 'yellow_heart', keywords: ['黄心', 'yellow', 'heart'] },
  { emoji: '💚', name: 'green_heart', keywords: ['绿心', 'green', 'heart'] },
  { emoji: '💙', name: 'blue_heart', keywords: ['蓝心', 'blue', 'heart'] },
  { emoji: '💜', name: 'purple_heart', keywords: ['紫心', 'purple', 'heart'] },
  { emoji: '🖤', name: 'black_heart', keywords: ['黑心', 'black', 'heart'] },
  { emoji: '🤍', name: 'white_heart', keywords: ['白心', 'white', 'heart'] },
  { emoji: '💔', name: 'broken_heart', keywords: ['心碎', 'broken', 'heart'] },
  { emoji: '💕', name: 'two_hearts', keywords: ['两颗心', '喜欢', 'hearts'] },
  { emoji: '💖', name: 'sparkling_heart', keywords: ['闪亮心', 'sparkling'] },
  // 自然
  { emoji: '🔥', name: 'fire', keywords: ['火', '厉害', 'fire', 'hot'] },
  { emoji: '✨', name: 'sparkles', keywords: ['闪亮', '星星', 'sparkles', 'magic'] },
  { emoji: '⭐', name: 'star', keywords: ['星', '星星', 'star'] },
  { emoji: '🌈', name: 'rainbow', keywords: ['彩虹', 'rainbow'] },
  { emoji: '☀️', name: 'sunny', keywords: ['太阳', '晴天', 'sun'] },
  { emoji: '🌙', name: 'moon', keywords: ['月亮', 'moon'] },
  { emoji: '⚡', name: 'zap', keywords: ['闪电', '电', 'lightning', 'zap'] },
  { emoji: '💧', name: 'droplet', keywords: ['水滴', 'water', 'drop'] },
  { emoji: '🌸', name: 'cherry_blossom', keywords: ['樱花', '花', 'blossom', 'flower'] },
  { emoji: '🍀', name: 'four_leaf_clover', keywords: ['四叶草', '幸运', 'luck', 'clover'] },
  // 物品
  { emoji: '🎉', name: 'tada', keywords: ['庆祝', '派对', 'party', 'celebrate'] },
  { emoji: '🎊', name: 'confetti_ball', keywords: ['庆祝', '彩带', 'confetti'] },
  { emoji: '🎁', name: 'gift', keywords: ['礼物', 'gift', 'present'] },
  { emoji: '🏆', name: 'trophy', keywords: ['奖杯', '冠军', 'trophy', 'champion'] },
  { emoji: '💡', name: 'bulb', keywords: ['灯泡', '想法', 'idea', 'light'] },
  { emoji: '📌', name: 'pushpin', keywords: ['图钉', '标记', 'pin'] },
  { emoji: '🔔', name: 'bell', keywords: ['铃铛', '通知', 'bell', 'notification'] },
  { emoji: '🔒', name: 'lock', keywords: ['锁', '安全', 'lock', 'secure'] },
  { emoji: '🔑', name: 'key', keywords: ['钥匙', 'key'] },
  { emoji: '📝', name: 'memo', keywords: ['备忘', '笔记', 'memo', 'note'] },
  { emoji: '📖', name: 'book', keywords: ['书', '阅读', 'book', 'read'] },
  { emoji: '🎯', name: 'dart', keywords: ['目标', '靶心', 'target', 'goal'] },
  { emoji: '🚀', name: 'rocket', keywords: ['火箭', '起飞', 'rocket', 'launch'] },
  { emoji: '💎', name: 'gem', keywords: ['钻石', '宝石', 'gem', 'diamond'] },
  { emoji: '🎵', name: 'musical_note', keywords: ['音乐', '音符', 'music', 'note'] },
  // 符号
  { emoji: '✅', name: 'white_check_mark', keywords: ['完成', '对', 'check', 'done', 'ok'] },
  { emoji: '❌', name: 'x', keywords: ['错误', '叉', 'cross', 'wrong', 'no'] },
  { emoji: '⚠️', name: 'warning', keywords: ['警告', '注意', 'warning', 'caution'] },
  { emoji: '❓', name: 'question', keywords: ['问题', '问号', 'question'] },
  { emoji: '💯', name: '100', keywords: ['满分', '一百分', '100', 'perfect'] },
  { emoji: '🆗', name: 'ok', keywords: ['好的', 'ok'] },
  { emoji: '🆕', name: 'new', keywords: ['新的', 'new'] },
  { emoji: '🆓', name: 'free', keywords: ['免费', 'free'] },
];

const _emojiLowerIndex: { nameLower: string; keywordsLower: string[] }[] = emojiItems.map(
  item => ({ nameLower: item.name.toLowerCase(), keywordsLower: item.keywords.map(kw => kw.toLowerCase()) }),
);

export const EmojiSuggest = Extension.create<EmojiSuggestOptions>({
  name: 'emojiSuggest',

  addOptions(): EmojiSuggestOptions {
    return {
      suggestion: {
        char: ':',
        startOfLine: false,
        items: ({ query }: { query: string }) => {
          const q = query.toLowerCase();
          if (!q) {
            return emojiItems.slice(0, 20);
          }
          return emojiItems.filter(
            (_, i) =>
              _emojiLowerIndex[i].nameLower.includes(q) ||
              _emojiLowerIndex[i].keywordsLower.some(kw => kw.includes(q)),
          );
        },
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).insertContent(props.emoji).run();
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: emojiPluginKey,
        ...this.options.suggestion,
      }),
    ];
  },
});
