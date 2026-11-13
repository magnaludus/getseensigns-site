// The proof tool's check that each customer field is printed somewhere on the sheet (scripts/proof-from-brief/printed.mjs).
// A name set on two lines counts as printed; words out of order, partial lines and unrelated lines do not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldIsPrinted } from '../../scripts/proof-from-brief/printed.mjs';

test('a field printed as one line is printed', () => {
  assert.equal(fieldIsPrinted('HONEYDROP', ['HONEYDROP', 'APIARY']), true);
});

test('a name set on two consecutive lines is printed', () => {
  assert.equal(fieldIsPrinted('MAPLE STREET BAKERY', ['MAPLE STREET', 'BAKERY']), true);
  assert.equal(fieldIsPrinted('MAPLE STREET BAKERY', ['FRESH', 'MAPLE STREET', 'BAKERY', 'DAILY']), true);
});

test('a name set on three lines is printed, and extra spaces do not matter', () => {
  assert.equal(fieldIsPrinted('BLUEBIRD  ROOFING AND RESTORATION', ['BLUEBIRD', ' ROOFING AND', 'RESTORATION ']), true);
});

test('part of a line is not the whole field', () => {
  assert.equal(fieldIsPrinted('MAPLE', ['MAPLE STREET']), false);
  assert.equal(fieldIsPrinted('MAPLE STREET BAKERY', ['MAPLE STREET']), false);
});

test('the lines must be in order and next to each other', () => {
  assert.equal(fieldIsPrinted('MAPLE STREET BAKERY', ['BAKERY', 'MAPLE STREET']), false);
  assert.equal(fieldIsPrinted('MAPLE STREET BAKERY', ['MAPLE STREET', 'FRESH BREAD DAILY', 'BAKERY']), false);
});

test('an empty field has nothing to print; a field that is nowhere is not printed', () => {
  assert.equal(fieldIsPrinted('', []), true);
  assert.equal(fieldIsPrinted('  ', ['HONEYDROP']), true);
  assert.equal(fieldIsPrinted('555-0142', ['HONEYDROP', 'APIARY']), false);
});
