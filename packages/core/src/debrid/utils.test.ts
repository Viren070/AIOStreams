import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../index.js';
import { isTitleWrong } from './utils.js';

const wrong = (parsed: string, titles: string[]) =>
  isTitleWrong({ title: parsed }, { titles });

describe('isTitleWrong', () => {
  it('rejects a title that only sits inside a word of the release', () => {
    // ratio("mayday", "ayda") is 80, right at the threshold
    assert.equal(wrong('Mayday', ['Айда!', 'Ayda!']), true);
    assert.equal(wrong('Ayda', ['Mayday']), true);
  });

  it('keeps a title that sits in the release as whole words', () => {
    assert.equal(wrong('Ayda 2', ['Ayda!']), false);
    assert.equal(wrong('The Office', ['Office']), false);
  });

  it('treats words written together as one word', () => {
    assert.equal(wrong('Spiderman', ['Spider-Man']), false);
    assert.equal(wrong('Spider Man', ['Spiderman']), false);
    assert.equal(wrong('Spider Man 2099', ['Spiderman']), false);
    assert.equal(wrong('Spiderman 2099', ['Spider-Man']), false);
  });

  it('leaves a cut-off title to the ratio', () => {
    assert.equal(
      wrong('Sen to Chihiro no Kamikakush', ['Sen to Chihiro no Kamikakushi']),
      false
    );
  });

  it('still matches other titles of the list when one sits inside a word', () => {
    assert.equal(wrong('Mayday', ['Ayda', 'Mayday!']), false);
  });

  it('does not split scripts written without spaces', () => {
    assert.equal(wrong('進撃の巨人完結', ['進撃の巨人']), false);
  });

  it('keeps the plain ratio when word by word normalises differently', () => {
    // collapseDigraphs folds the `ae` across the space only in the whole title
    assert.equal(wrong('Antalen', ['Santa Elena']), false);
  });

  it('keeps the plain ratio for titles that do not contain each other', () => {
    assert.equal(wrong('Playdate', ['Ayda']), true);
    assert.equal(wrong('The Office', ['The Ofice']), false);
  });
});
