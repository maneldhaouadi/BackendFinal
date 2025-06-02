import { ArticleData } from 'src/modules/article/article/interfaces/article-data.interface';
import { OEM, PSM } from 'tesseract.js';

export interface ICorrectionLog {
  original: string;
  corrected: string;
  context: string[];
  confidence?: number;
  timestamp: Date;
}

export interface IOcrTextResult {
  success: boolean;
  data: {
    text: string;
    corrections: ICorrectionLog[];
  };
}

export interface IOcrArticleResult {
  success: boolean;
  data: ArticleData;
  corrections: ICorrectionLog[];
}

export interface IArticleOcrConfig {
  lang: string;
  oem: OEM;
  psm: PSM;
  preserveInterwordSpaces: boolean;
  tesseditCharWhitelist: string;
  errorCorrection: {
    commonErrors: Record<string, string>;
    minConfidence: number;
  };
  advancedCorrection: {
    enableContextAwareCorrection: boolean;
    maxCorrectionDistance: number;
    minContextMatch: number;
    semanticGroups: Record<string, string[]>;
  };
}

type FieldPattern = {
  regex: RegExp;
  field: keyof ArticleData;
};