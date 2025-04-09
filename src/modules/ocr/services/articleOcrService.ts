import { Injectable } from '@nestjs/common';
import { createWorker, PSM, OEM } from 'tesseract.js';

@Injectable()
export class ArticleOcrService {
  private readonly ocrConfig = {
    lang: 'fra+eng',
    oem: OEM.LSTM_ONLY,
    psm: PSM.AUTO,
    preserveInterwordSpaces: true
  };

  async extractTextFromImage(imagePath: string): Promise<string> {
    const worker = await createWorker();
    
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: '1',
      });

      const { data: { text } } = await worker.recognize(imagePath);
      return text;
    } finally {
      await worker.terminate();
    }
  }

  async extractArticleData(text: string): Promise<ArticleData> {
    // Normalisation spécifique pour le format clé-valeur
    const normalizedText = this.normalizeLineEndings(text);
    
    const data: ArticleData = {
      title: this.extractExactValue(normalizedText, 'title'),
      description: this.extractExactValue(normalizedText, 'description'),
      category: this.extractExactValue(normalizedText, 'category'),
      subCategory: this.extractExactValue(normalizedText, 'subcategory'),
      purchasePrice: this.extractNumberValue(normalizedText, 'purchaseprice'),
      salePrice: this.extractNumberValue(normalizedText, 'saleprice'),
      quantityInStock: this.extractIntegerValue(normalizedText, 'quantityinstock'),
      barcode: this.extractExactValue(normalizedText, 'barcode'),
      status: this.extractStatus(normalizedText),
      version: this.extractVersion(normalizedText),
      date: new Date(),
      rawText: text
    };

    // Nettoyage des valeurs string
    if (data.barcode?.toLowerCase() === 'null') data.barcode = null;

    return data;
  }

  private normalizeLineEndings(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\n+/g, '\n')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractExactValue(text: string, key: string): string | null {
    const regex = new RegExp(`${key}[\\s,:]+([^\\n,]+)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : null;
  }

  private extractNumberValue(text: string, key: string): number | null {
    const value = this.extractExactValue(text, key);
    if (!value) return null;

    const num = parseFloat(value.replace(/[^\d.-]/g, ''));
    return isNaN(num) ? null : parseFloat(num.toFixed(2));
  }

  private extractIntegerValue(text: string, key: string): number | null {
    const value = this.extractExactValue(text, key);
    if (!value) return null;

    const int = parseInt(value.replace(/[^\d]/g, ''), 10);
    return isNaN(int) ? null : int;
  }

  private extractStatus(text: string): string {
    const value = this.extractExactValue(text, 'status');
    return value?.toLowerCase() === 'imported' ? 'imported' : 'draft';
  }

  private extractVersion(text: string): number {
    const value = this.extractExactValue(text, 'version');
    if (!value) return 1;

    const version = parseInt(value.replace(/[^\d]/g, ''), 10);
    return isNaN(version) ? 1 : version;
  }
}

export interface ArticleData {
  title: string | null;
  description: string | null;
  category: string | null;
  subCategory: string | null;
  purchasePrice: number | null;
  salePrice: number | null;
  quantityInStock: number | null;
  barcode: string | null;
  status: string;
  version: number;
  date: Date | null;
  rawText: string;
}