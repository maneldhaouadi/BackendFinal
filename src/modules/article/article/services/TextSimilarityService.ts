// src/common/text/text-similarity.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class TextSimilarityService {
  /**
   * Calcule la similarité entre deux chaînes (0 à 1)
   */
  similarity(s1: string, s2: string): number {
    if (!s1 || !s2) return 0;
    
    // Normalisation plus poussée
    s1 = this.normalizeText(s1);
    s2 = this.normalizeText(s2);
    
    // Si l'un est inclus dans l'autre après normalisation
    if (s1.includes(s2) || s2.includes(s1)) {
      return 0.9; // Haut score pour inclusion
    }
    
    // Distance de Levenshtein améliorée
    const distance = this.levenshteinDistance(s1, s2);
    const maxLength = Math.max(s1.length, s2.length);
    
    return 1 - (distance / maxLength);
  }

  /**
   * Implémentation optimisée de Levenshtein
   */
  private levenshteinDistance(s1: string, s2: string): number {
    const len1 = s1.length;
    const len2 = s2.length;
    const matrix = [];

    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    return matrix[len1][len2];
  }

  /**
   * Normalisation avancée du texte
   */
  normalizeText(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // supprime les accents
      .replace(/[^\w\s]/g, '') // supprime la ponctuation
      .replace(/\s+/g, ' ') // réduit les espaces multiples
      .trim();
  }

  /**
   * Vérifie la similarité avec seuil dynamique
   */
  isSimilar(text1: string, text2: string, threshold = 0.7): boolean {
    // Seuil plus bas pour les chaînes courtes
    const dynamicThreshold = text1.length < 5 ? 0.6 : threshold;
    return this.similarity(text1, text2) >= dynamicThreshold;
  }
}