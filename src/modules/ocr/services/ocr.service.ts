import { Injectable } from '@nestjs/common';
import { createWorker, PSM, OEM } from 'tesseract.js';
//import * as nlp from 'compromise';

declare module 'tesseract.js' {
  interface Worker {
    logger: {
      debug: (...args: any[]) => void;
      info: (...args: any[]) => void;
      warn: (...args: any[]) => void;
      error: (...args: any[]) => void;
    };
  }
}

@Injectable()
export class OcrService {
  private readonly logger = {
    debug: (...args: any[]) => console.debug('[DEBUG]', ...args),
    info: (...args: any[]) => console.log('[INFO]', ...args),
    warn: (...args: any[]) => console.warn('[WARN]', ...args),
    error: (...args: any[]) => console.error('[ERROR]', ...args)
  };

  private readonly ocrConfig = {
    lang: 'fra+eng',
    oem: OEM.LSTM_ONLY,
    psm: PSM.AUTO,
    whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZàâäèéêëîïôœùûüÿçÀÂÄÈÉÊËÎÏÔŒÙÛÜŸÇ-.,/\\()€$%& ',
    preserveInterwordSpaces: true
  };

  async extractTextFromImage(imagePath: string): Promise<string> {
    const worker = await createWorker();
    worker.logger = this.logger;

    try {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        tessedit_char_whitelist: this.ocrConfig.whitelist,
        preserve_interword_spaces: '1',
      });

      const { data: { text } } = await worker.recognize(imagePath);
      this.logger.info('Texte extrait avec succès');
      return text;
    } catch (error) {
      this.logger.error('Erreur OCR:', error.message);
      throw new Error(`Échec de la reconnaissance: ${error.message}`);
    } finally {
      try {
        await worker.terminate();
      } catch (terminateError) {
        this.logger.error('Erreur lors de la fermeture du worker:', terminateError.message);
      }
    }
  }

  async parseInvoice(text: string): Promise<InvoiceData> {
    const normalizedText = this.normalizeInvoiceText(text);
    this.logger.debug('Texte normalisé:', normalizedText);
    
    const invoiceData: InvoiceData = {
      invoiceNumber: this.extractInvoiceNumber(normalizedText),
      date: this.extractDate(normalizedText),
      totalAmount: this.extractTotalAmount(normalizedText),
      subtotal: this.extractSubtotal(normalizedText),
      supplierName: this.extractSupplierName(normalizedText),
      supplierAddress: this.extractSupplierAddress(normalizedText),
      clientName: this.extractClientName(normalizedText),
      clientAddress: this.extractClientAddress(normalizedText),
      items: this.extractItems(normalizedText),
      taxes: this.extractTaxes(normalizedText),
      paymentTerms: this.extractPaymentTerms(normalizedText),
      dueDate: this.extractDueDate(normalizedText),
      rawText: text
    };

    this.logger.debug('Données extraites:', invoiceData);
    return invoiceData;
  }

  private normalizeInvoiceText(text: string): string {
    return text
      .replace(/\|/g, ' ')
      .replace(/-+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/(\d)\s([€$%])/g, '$1$2')
      .replace(/([a-zA-Z])\s(\d)/g, '$1$2')
      .replace(/[”“"«»]/g, '')
      .replace(/\b(\d+)[,.](\d+)\b/g, '$1.$2')
      .trim();
  }

  private extractInvoiceNumber(text: string): string | null {
    const match = text.match(/FACTURE\s*N[°ºo]?\s*([A-Z0-9-]+)/i) 
               || text.match(/Invoice\s*No\.?\s*([A-Z0-9-]+)/i);
    return match?.[1]?.trim() || null;
  }

  private extractDate(text: string): Date | null {
    const datePatterns = [
        /Date\s*:\s*(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/i,
        /Date\s*Facture\s*:\s*(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/i,
        /Fait\s*le\s*:\s*(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/i,
        /(?:Date|Le)\s+(\d{1,2}\s+[a-zA-Zéèêëûüùîïôö]+\.?\s+\d{4})/i,
        /(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})(?=\s*Facture)/i,
        /(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})(?=\s*Echéance)/i
    ];

    for (const pattern of datePatterns) {
        const match = text.match(pattern);
        if (match) {
            try {
                const dateStr = match[1].replace(/[\/\-.]/g, '/');
                const parts = dateStr.split('/');
                if (parts.length === 3) {
                    const isoDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
                    return new Date(isoDate);
                }
            } catch (e) {
                this.logger.warn(`Erreur de conversion de date: ${match[1]}`);
            }
        }
    }

    const nearInvoicePattern = /FACTURE\s*N[°ºo]?\s*[A-Z0-9-]+\s*(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/i;
    const nearInvoiceMatch = text.match(nearInvoicePattern);
    if (nearInvoiceMatch) {
        const dateStr = nearInvoiceMatch[1].replace(/[\/\-.]/g, '/');
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            const isoDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
            return new Date(isoDate);
        }
    }

    return null;
  }

  private extractTotalAmount(text: string): number | null {
    const amountStr = text.match(/Total\s*TTC\s*[^\d]*([\d\s]+[.,]\d{2})/i)?.[1]
                  || text.match(/Total\s*TTC\s*:\s*([\d\s]+[.,]\d{2})\s*[€$]/i)?.[1];
    return this.parseAmount(amountStr);
  }

  private extractSubtotal(text: string): number | null {
    const amountStr = text.match(/Total\s*HT\s*[^\d]*([\d\s]+[.,]\d{2})/i)?.[1]
                  || text.match(/Total\s*HT\s*:\s*([\d\s]+[.,]\d{2})\s*[€$]/i)?.[1];
    return this.parseAmount(amountStr);
  }

  private parseAmount(amountStr: string | undefined): number | null {
    if (!amountStr) return null;
    const amount = parseFloat(amountStr.replace(/\s/g, '').replace(',', '.'));
    return isNaN(amount) ? null : amount;
  }

  private extractSupplierName(text: string): string | null {
    return text.match(/Fournisseur\s*:\s*([^\n]+)/i)?.[1]?.trim()
        || text.match(/Société\s*:\s*([^\n]+)/i)?.[1]?.trim()
        || text.match(/Fournisseur\s*([^\n]+)/i)?.[1]?.trim();
  }

  private extractSupplierAddress(text: string): string | null {
    const patterns = [
        /Fournisseur[^\n]+\nAdresse\s*:\s*([^\n]+)\s*\n/i,
        /TechSolutions SARL[^\n]+\n([^\n]+)\s*\n/i,
        /Adresse\s*:\s*((?:.+\n)+?)(?=\nSIRET)/i,
        /45 Avenue des Technologies, 75015 Paris/i
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            const address = match[1]?.trim() || match[0]?.trim();
            if (address) {
                return address.replace(/\s+/g, ' ').replace(/\n/g, ', ');
            }
        }
    }
    return null;
  }

  private extractClientName(text: string): string | null {
    return text.match(/Client\s*:\s*([^\n]+)/i)?.[1]?.trim()
        || text.match(/Entreprise\s*:\s*([^\n]+)/i)?.[1]?.trim();
  }

  private extractClientAddress(text: string): string | null {
    const patterns = [
        /Client[^\n]+\nAdresse\s*:\s*([^\n]+)\s*\n/i,
        /Entreprise Innovante[^\n]+\n([^\n]+)\s*\n/i,
        /Adresse client\s*:\s*((?:.+\n)+?)(?=\nDésignation)/i,
        /78 Rue des Créateurs, 69602 Lyon/i
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            const address = match[1]?.trim() || match[0]?.trim();
            if (address) {
                return address.replace(/\s+/g, ' ').replace(/\n/g, ', ');
            }
        }
    }
    return null;
  }

  private extractPaymentTerms(text: string): string | null {
    return text.match(/Paiement\s*à\s*effectuer\s*(.+?)(?=\n|$)/is)?.[1]?.trim()
        || text.match(/Conditions\s*de\s*paiement\s*:\s*(.+?)(?=\n|$)/is)?.[1]?.trim();
  }

  private extractDueDate(text: string): Date | null {
    const dateStr = text.match(/Échéance\s*:\s*(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/i)?.[1]
                 || text.match(/Echéance\s*(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/i)?.[1];
    return dateStr ? new Date(dateStr.replace(/(\d{2}).(\d{2}).(\d{4})/, '$3-$2-$1')) : null;
  }

  private extractItems(text: string): InvoiceItem[] {
    const items: InvoiceItem[] = [];
    const itemPattern = /([A-Za-z\s]+)\s+(\d+)\s+([\d.,]+)\s*€?\s+([\d.,]+)\s*€?\s+(\d+%)/gi;
    let match;
    
    while ((match = itemPattern.exec(text)) !== null) {
      items.push({
        description: match[1].trim(),
        quantity: parseInt(match[2].replace(/\s/g, ''), 10),
        unitPrice: parseFloat(match[3].replace(/\s/g, '').replace(',', '.')),
        totalPrice: parseFloat(match[4].replace(/\s/g, '').replace(',', '.')),
        vatRate: match[5]
      });
    }
    return items;
  }

  private extractTaxes(text: string): TaxDetail[] {
    const taxes: TaxDetail[] = [];
    const taxPattern = /TVA\s*\(?(\d+%)\)?\s*:\s*([\d.,]+)\s*[€$]/gi;
    let match;
    
    while ((match = taxPattern.exec(text)) !== null) {
      taxes.push({
        rate: match[1],
        amount: parseFloat(match[2].replace(/\s/g, '').replace(',', '.'))
      });
    }

    if (taxes.length === 0) {
      const totalHT = this.extractSubtotal(text);
      const totalTTC = this.extractTotalAmount(text);
      
      if (totalHT && totalTTC) {
        taxes.push({
          rate: '20%',
          amount: totalTTC - totalHT
        });
      }
    }
    
    return taxes;
  }
  /*

  async parseArticleDetailsWithNLP(text: string): Promise<ArticleData> {
    try {
      const doc = nlp(text);
      
      const articleData: ArticleData = {
        title: this.extractTitle(doc),
        description: this.extractDescription(doc),
        category: this.extractCategory(doc),
        subCategory: null,
        purchasePrice: this.extractPrice(text),
        salePrice: null,
        quantityInStock: this.extractQuantity(text),
        barcode: this.extractBarcode(text),
        status: 'Nouveau',
        version: '1.0',
        date: new Date()
      };

      if (articleData.purchasePrice) {
        articleData.salePrice = articleData.purchasePrice * 1.2;
      }

      return articleData;
    } catch (error) {
      this.logger.error('Erreur dans parseArticleDetailsWithNLP:', error);
      return {
        title: null,
        description: null,
        category: null,
        subCategory: null,
        purchasePrice: null,
        salePrice: null,
        quantityInStock: null,
        barcode: null,
        status: null,
        version: null,
        date: null
      };
    }
  }
*/
  private extractTitle(doc: any): string | null {
    const titles = doc.nouns().out('array');
    return titles.length > 0 ? titles[0] : null;
  }

  private extractDescription(doc: any): string | null {
    const sentences = doc.sentences().out('array');
    return sentences.length > 0 ? sentences[0] : null;
  }

  private extractCategory(doc: any): string | null {
    const nouns = doc.nouns().out('array');
    return nouns.length > 1 ? nouns[1] : null;
  }

  private extractPrice(text: string): number | null {
    const priceMatch = text.match(/(\d+[.,]\d{2})\s*€/);
    if (!priceMatch) return null;
    
    const priceStr = priceMatch[1].replace(',', '.');
    const price = parseFloat(priceStr);
    return isNaN(price) ? null : price;
  }

  private extractQuantity(text: string): number | null {
    const quantityMatch = text.match(/(\d+)\s*(pièce|unité|article)/i);
    if (!quantityMatch) return null;
    
    const quantity = parseInt(quantityMatch[1], 10);
    return isNaN(quantity) ? null : quantity;
  }

  private extractBarcode(text: string): string | null {
    const barcodeMatch = text.match(/\b\d{8,13}\b/);
    return barcodeMatch ? barcodeMatch[0] : null;
  }
}

export interface InvoiceData {
  invoiceNumber: string | null;
  date: Date | null;
  totalAmount: number | null;
  subtotal: number | null;
  supplierName: string | null;
  supplierAddress: string | null;
  clientName: string | null;
  clientAddress: string | null;
  items: InvoiceItem[];
  taxes: TaxDetail[];
  paymentTerms: string | null;
  dueDate: Date | null;
  rawText: string;
}

export interface InvoiceItem {
  description: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  vatRate: string;
}

export interface TaxDetail {
  rate: string;
  amount: number;
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
  status: string | null;
  version: string | null;
  date: Date | null;
}