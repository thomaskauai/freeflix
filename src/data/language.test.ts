import { describe, expect, it } from 'vitest';
import { normalizeLanguage, subtitleCodes } from './language';

describe('normalizeLanguage', () => {
  it('código ISO 639-1 do catálogo (original_language do TMDB) fica como está', () => {
    expect(normalizeLanguage('en')).toBe('en');
    expect(normalizeLanguage('ja')).toBe('ja');
    expect(normalizeLanguage('KO')).toBe('ko');
  });
  it('nome do idioma vira código', () => {
    expect(normalizeLanguage('English')).toBe('en');
    expect(normalizeLanguage('Japanese')).toBe('ja');
    expect(normalizeLanguage('Portuguese')).toBe('pt');
    expect(normalizeLanguage('Português')).toBe('pt');
    expect(normalizeLanguage('English, French')).toBe('en');
  });
  it('região e 3 letras', () => {
    expect(normalizeLanguage('pt-BR')).toBe('pt');
    expect(normalizeLanguage('eng')).toBe('en');
    expect(normalizeLanguage('jpn')).toBe('ja');
    expect(normalizeLanguage('pob')).toBe('pt');
  });
  it('sem idioma ou desconhecido fica vazio; cantonês do TMDB é chinês', () => {
    expect(normalizeLanguage(undefined)).toBe('');
    expect(normalizeLanguage('')).toBe('');
    expect(normalizeLanguage('xx')).toBe('');
    expect(normalizeLanguage('und')).toBe('');
    expect(normalizeLanguage('Klingon')).toBe('');
    expect(normalizeLanguage('cn')).toBe('zh');
  });
});

describe('subtitleCodes', () => {
  it('códigos do OpenSubtitles', () => {
    expect(subtitleCodes('pt')).toEqual(['pob', 'por']);
    expect(subtitleCodes('en')).toEqual(['eng']);
    expect(subtitleCodes('ja')).toEqual(['jpn']);
    expect(subtitleCodes('ko')).toEqual(['kor']);
    expect(subtitleCodes('fr')).toEqual(['fre']);
    expect(subtitleCodes('de')).toEqual(['ger']);
    expect(subtitleCodes('qq')).toEqual([]);
  });
});
