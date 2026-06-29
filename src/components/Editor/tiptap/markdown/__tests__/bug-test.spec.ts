import { describe, it, expect } from 'vitest';
import { createTestSchema, roundTrip, normalize } from './test-utils';

describe('Additional edge case diagnostics', () => {
  // Verify __ (underscore) bold delimiter behavior
  it('__bold__ with chinese comma and adjacent text', () => {
    const input = '__沉浸式体验，__继续\n';
    const result = roundTrip(input);
    console.log('UNDERSCORE INPUT:', JSON.stringify(input));
    console.log('UNDERSCORE OUTPUT:', JSON.stringify(result));
  });

  // Verify with a space before closing **
  it('**bold** with space before ** and text after', () => {
    const input = '**沉浸式体验， **继续\n';
    const result = roundTrip(input);
    console.log('SPACE INPUT:', JSON.stringify(input));
    console.log('SPACE OUTPUT:', JSON.stringify(result));
  });

  // Verify with backslash before the comma (escaping the comma)
  it('**bold** with backslash-escaped comma', () => {
    const input = '**沉浸式体验\\，**继续\n';
    const result = roundTrip(input);
    console.log('ESCAPED COMMA INPUT:', JSON.stringify(input));
    console.log('ESCAPED COMMA OUTPUT:', JSON.stringify(result));
  });

  // Latin comma + text without space
  it('**bold** with latin comma adjacent to text', () => {
    const input = '**immersive,**test\n';
    const result = roundTrip(input);
    console.log('LATIN INPUT:', JSON.stringify(input));
    console.log('LATIN OUTPUT:', JSON.stringify(result));
  });

  // Check if inline code within bold works
  it('**bold** with chinese comma and ascii char after', () => {
    const input = '**沉浸式体验，**a\n';
    const result = roundTrip(input);
    console.log('ASCII AFTER INPUT:', JSON.stringify(input));
    console.log('ASCII AFTER OUTPUT:', JSON.stringify(result));
  });

  // Bold with chinese period and adjacent text
  it('**bold** with chinese period adj text', () => {
    const input = '**沉浸式体验。**继续\n';
    const result = roundTrip(input);
    console.log('PERIOD INPUT:', JSON.stringify(input));
    console.log('PERIOD OUTPUT:', JSON.stringify(result));
  });

  // Bold with only Chinese punct and text after
  it('single char bold chinese punct adj text', () => {
    const input = '**，**test\n';
    const result = roundTrip(input);
    console.log('PUNCT ONLY INPUT:', JSON.stringify(input));
    console.log('PUNCT ONLY OUTPUT:', JSON.stringify(result));
  });

  // Bold at end of line (no newline even)
  it('bold at end of string without newline', () => {
    const input = '这是**沉浸式体验，**';
    const result = roundTrip(input);
    console.log('NO NEWLINE INPUT:', JSON.stringify(input));
    console.log('NO NEWLINE OUTPUT:', JSON.stringify(result));
  });

  // Bold with regular period and adjacent text
  it('**bold** with latin period adj text', () => {
    const input = '**end.**next\n';
    const result = roundTrip(input);
    console.log('PERIOD LATIN INPUT:', JSON.stringify(input));
    console.log('PERIOD LATIN OUTPUT:', JSON.stringify(result));
  });
});
