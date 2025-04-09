import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ArticleData } from 'src/modules/ocr/services/articleOcrService';

@Injectable()
export class PdfExtractionService {
  private pdfjs: any;

  constructor() {
    this.initializePdfJs();
  }

  async extractArticleDataFromPdf(pdfPath: string): Promise<ArticleData> {
    await this.validatePdfPath(pdfPath);
    try {
      const text = await this.extractTextFromPdf(pdfPath);
      return this.parseArticleData(text);
    } catch (error) {
      throw new Error(`PDF processing failed: ${error.message}`);
    }
  }

  private initializePdfJs() {
    this.pdfjs = require('pdfjs-dist/legacy/build/pdf');
    this.pdfjs.GlobalWorkerOptions.workerSrc = require.resolve(
      'pdfjs-dist/legacy/build/pdf.worker.min.js'
    );
  }

  private async extractTextFromPdf(pdfPath: string): Promise<string> {
    const data = new Uint8Array(await fs.readFile(pdfPath));
    const pdf = await this.pdfjs.getDocument(data).promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      
      // Conservation des sauts de ligne
      textContent.items.forEach((item: any, index: number) => {
        fullText += item.str;
        // Ajoute un saut de ligne si l'item suivant est sur une nouvelle ligne
        if (textContent.items[index + 1]?.transform[5] !== item.transform[5]) {
          fullText += '\n';
        }
      });
    }

    return fullText;
  }

  private parseArticleData(text: string): ArticleData {
    // Convertit le texte en objet clé-valeur
    const lines = text.split('\n').filter(line => line.includes(':'));
    const data: Record<string, string> = {};

    lines.forEach(line => {
      const [key, ...values] = line.split(':').map(s => s.trim());
      if (key && values.length) {
        data[key.toLowerCase()] = values.join(':').trim();
      }
    });

    return {
      title: data['title'] || 'Titre non trouvé',
      description: data['description'] || '',
      category: data['category'] || 'Catégorie non trouvée',
      subCategory: data['subcategory'] || '',
      purchasePrice: parseFloat((data['purchaseprice'] || '0').replace(',', '.')) || 0,
      salePrice: parseFloat((data['saleprice'] || '0').replace(',', '.')) || 0,
      quantityInStock: parseInt(data['quantityinstock'] || '0') || 0,
      barcode: data['barcode'] || 'Code non trouvé',
      status: 'draft',
      version: 1,
      date: new Date(),
      rawText: text
    };
  }

  private async validatePdfPath(pdfPath: string): Promise<void> {
    try {
      await fs.access(pdfPath);
      if (path.extname(pdfPath).toLowerCase() !== '.pdf') {
        throw new Error('Le fichier doit être au format PDF');
      }
    } catch (error) {
      throw new Error(`Fichier PDF invalide: ${error.message}`);
    }
  }

  
}