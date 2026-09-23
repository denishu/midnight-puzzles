import { validateGuessText, validateWordleGuess } from '../../../core/utils/InputValidator';

describe('validateGuessText', () => {
  it('accepts a simple word and trims it', () => {
    const r = validateGuessText('  ocean  ');
    expect(r.ok).toBe(true);
    expect(r.value).toBe('ocean');
  });

  it('accepts accented and punctuated country names', () => {
    expect(validateGuessText("Côte d'Ivoire").ok).toBe(true);
    expect(validateGuessText('St. Lucia').ok).toBe(true);
    expect(validateGuessText('Guinea-Bissau').ok).toBe(true);
  });

  it('rejects non-strings', () => {
    expect(validateGuessText(123).ok).toBe(false);
    expect(validateGuessText(null).ok).toBe(false);
    expect(validateGuessText(undefined).ok).toBe(false);
    expect(validateGuessText({}).ok).toBe(false);
  });

  it('rejects empty / whitespace-only', () => {
    expect(validateGuessText('').ok).toBe(false);
    expect(validateGuessText('   ').ok).toBe(false);
  });

  it('rejects over-long input', () => {
    expect(validateGuessText('a'.repeat(61)).ok).toBe(false);
  });

  it('rejects control chars, digits, and injection-y payloads', () => {
    expect(validateGuessText('word123').ok).toBe(false);
    expect(validateGuessText('<script>').ok).toBe(false);
    expect(validateGuessText('a\nb').ok).toBe(false);
    expect(validateGuessText('DROP TABLE;').ok).toBe(false); // semicolon not allowed
  });

  it('requires the first char to be a letter', () => {
    expect(validateGuessText('-hyphen').ok).toBe(false);
    expect(validateGuessText('.dot').ok).toBe(false);
  });
});

describe('validateWordleGuess', () => {
  it('accepts exactly 5 letters and uppercases', () => {
    const r = validateWordleGuess('crane');
    expect(r.ok).toBe(true);
    expect(r.value).toBe('CRANE');
  });

  it('trims surrounding whitespace', () => {
    expect(validateWordleGuess('  crane ').value).toBe('CRANE');
  });

  it('rejects wrong lengths', () => {
    expect(validateWordleGuess('cat').ok).toBe(false);
    expect(validateWordleGuess('planet').ok).toBe(false);
    expect(validateWordleGuess('').ok).toBe(false);
  });

  it('rejects non-letters', () => {
    expect(validateWordleGuess('cr4ne').ok).toBe(false);
    expect(validateWordleGuess('cr ne').ok).toBe(false);
    expect(validateWordleGuess('cr-ne').ok).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(validateWordleGuess(12345).ok).toBe(false);
    expect(validateWordleGuess(null).ok).toBe(false);
  });
});
