import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ArticleData } from 'src/modules/article/interfaces/article-data.interface';


@Injectable()
export class PdfExtractionService {
  private pdfjs: any;

 /* constructor() {
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

  ////////////////////////////////////
  //traduction

  
  /*
  async extractAndTranslatePdf(
    pdfPath: string,
    targetLang: string = 'en'
  ): Promise<{ original: ArticleData; translated: ArticleData; translatedPdf: Buffer }> {
    // 1. Extraire les données originales
    const originalData = await this.extractArticleDataFromPdf(pdfPath);
  
    // 2. Traduire les champs textuels
    const translatedData: ArticleData = {
      ...originalData,
      title: await this.translateText(originalData.title, targetLang),
      description: await this.translateText(originalData.description, targetLang),
      category: await this.translateText(originalData.category, targetLang),
      subCategory: await this.translateText(originalData.subCategory, targetLang),
    };
  
    // 3. Recréer un PDF avec les données traduites
    const translatedPdf = await this.generateTranslatedPdf(translatedData);
  
    return {
      original: originalData,
      translated: translatedData,
      translatedPdf
    };
  }
  
  private async translateText(text: string, targetLang: string): Promise<string> {
    if (!text) return text;
    
    try {
      // Utilisation de l'API MyMemory (gratuite)
      const response = await axios.get(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=auto|${targetLang}`
      );
      return response.data.responseData.translatedText || text;
    } catch (error) {
      console.error('Erreur de traduction:', error);
      return text; // Retourne le texte original en cas d'erreur
    }
  }
  
  private async generateTranslatedPdf(data: ArticleData): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 800]);
    
    const { height } = page.getSize();
    let yPosition = height - 50;
  
    // Ajout des données traduites au PDF
    const addText = (text: string, size = 12) => {
      page.drawText(text, { x: 50, y: yPosition, size });
      yPosition -= size + 10;
    };
  
    addText(`Titre: ${data.title}`, 14);
    addText(`Description: ${data.description}`);
    addText(`Catégorie: ${data.category}`);
    addText(`Sous-catégorie: ${data.subCategory}`);
    addText(`Prix d'achat: ${data.purchasePrice} €`);
    addText(`Prix de vente: ${data.salePrice} €`);
    addText(`Stock: ${data.quantityInStock}`);
  
    return Buffer.from(await pdfDoc.save());
  }*/

  
}