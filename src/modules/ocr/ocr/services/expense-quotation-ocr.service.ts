import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { createWorker, Worker, OEM, PSM } from 'tesseract.js';
import { existsSync, unlinkSync } from 'fs';
import Fuse from 'fuse.js';
import { CorrectionLog, ExpenseQuotationOcrResponse, FieldRecognitionResult } from '../dtos/expense-quotation-ocr-result.dto';

interface FieldConfig {
  name: string;
  synonyms: string[];
  patterns: {
    regex: RegExp;
    example: string;
    priority: number;
    valueGroup?: number;
    valueProcessor?: (value: string) => any;
  }[];
}

interface Article {
  reference?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  discount?: number;
  discountType?: 'PERCENTAGE' | 'FIXED_AMOUNT';
}

@Injectable()
export class ExpenseQuotationOcrService implements OnModuleDestroy {
  private readonly logger = new Logger(ExpenseQuotationOcrService.name);
  private workerPool: Worker[] = [];
  private readonly MAX_WORKERS = 3;
  private lastConfidence = 0;
  private fuse: Fuse<FieldConfig>;

  private readonly fieldConfigs: FieldConfig[] = [
    {
      name: 'reference',
      synonyms: ['référence', 'ref', 'numéro', 'n°', 'no', 'devis', 'code', 'identifiant'],
      patterns: [
        {
          regex: /(?:référence|reference|ref|numéro|n°|no|devis)\s*[:=\-]?\s*([A-Z]{2,}\d{2,}-\d{3,})/i,
          example: "Référence: DEV2023-456",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => val.toUpperCase()
        },
        {
          regex: /(?:référence|reference|ref|numéro|n°|no|devis)\s*[:=\-]?\s*(\d{2,}-\d{3,})/i,
          example: "Ref: 2023-456",
          priority: 2,
          valueGroup: 1
        }
      ]
    },
    {
      name: 'date',
      synonyms: ['date', 'créé le', 'émis le', 'du'],
      patterns: [
        {
          regex: /(?:date|créé le|émis le|du)\s*[:=\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
          example: "Date: 12/05/2023",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => this.normalizeDate(val)
        },
        {
          regex: /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
          example: "12-05-2023",
          priority: 2,
          valueGroup: 1,
          valueProcessor: (val) => this.normalizeDate(val)
        }
      ]
    },
    {
      name: 'client',
      synonyms: ['client', 'customer', 'acheteur', 'destinataire', 'entreprise'],
      patterns: [
        {
          regex: /(?:client|customer|acheteur|destinataire|entreprise)\s*[:=\-]?\s*([^\n]+)/i,
          example: "Client: Entreprise ABC",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => this.cleanClientField(val.trim())
        }
      ]
    },
    {
      name: 'subTotal',
      synonyms: ['sous-total', 'total HT', 'montant HT', 'hors taxe', 'avant taxes'],
      patterns: [
        {
          regex: /(?:sous-total|total HT|montant HT|hors taxe|avant taxes)\s*[:=\-]?\s*([\d\s]+[.,]\d{2})\s*(?:€|EUR|USD)?/i,
          example: "Total HT: 1,234.56 €",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => this.parseNumber(val)
        }
      ]
    },
    {
      name: 'vat',
      synonyms: ['tva', 'taxe', 'vat', 'tax'],
      patterns: [
        {
          regex: /(?:tva|taxe|vat|tax)\s*(\d{1,2})%\s*[:=\-]?\s*([\d\s]+[.,]\d{2})\s*(?:€|EUR|USD)?/i,
          example: "TVA 20%: 103.68€",
          priority: 1,
          valueGroup: 2,
          valueProcessor: (val) => this.parseNumber(val)
        },
        {
          regex: /(?:tva|taxe|vat|tax)\s*[:=\-]?\s*([\d\s]+[.,]\d{2})\s*(?:€|EUR|USD)?/i,
          example: "TVA: 103.68€",
          priority: 2,
          valueGroup: 1,
          valueProcessor: (val) => this.parseNumber(val)
        }
      ]
    },
    {
      name: 'total',
      synonyms: ['total', 'montant TTC', 'total TTC', 'à payer', 'net à payer'],
      patterns: [
        {
          regex: /(?:total|montant TTC|total TTC|à payer|net à payer)\s*[:=\-]?\s*([\d\s]+[.,]\d{2})\s*(?:€|EUR|USD)?/i,
          example: "Total TTC: 1,478.35 €",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => this.parseNumber(val)
        }
      ]
    },
    {
      name: 'paymentTerms',
      synonyms: ['conditions de paiement', 'paiement', 'payment terms', 'modalités de paiement'],
      patterns: [
        {
          regex: /(?:conditions de paiement|paiement|payment terms|modalités de paiement)\s*[:=\-]?\s*(.+?)(?=\n|$)/i,
          example: "Conditions de paiement: 30 jours fin de mois",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => val.trim()
        }
      ]
    }
  ];

  constructor() {
    this.initializeFieldSearch();
  }

  private cleanClientField(clientText: string): string {
    return clientText
      .replace(/(DSIGNATION|QTE|Clavier|cran|Souris|subTotal|vat|total|PU HT|paymentTerms).*/gi, '')
      .replace(/\d[\d.,]*/g, '')
      .replace(/[^a-zA-Z0-9éèêëàâäôöûüçÉÈÊËÀÂÄÔÖÛÜÇ\s-]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  private parseNumber(value: string): number {
    return parseFloat(value.replace(/\s/g, '').replace(',', '.'));
  }

  private normalizeDate(dateStr: string): string {
    const parts = dateStr.split(/[\/\-\.]/);
    if (parts.length === 3) {
      const day = parts[0].padStart(2, '0');
      const month = parts[1].padStart(2, '0');
      const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
      return `${year}-${month}-${day}`;
    }
    return dateStr;
  }

  private initializeFieldSearch() {
    this.fuse = new Fuse(this.fieldConfigs, {
      keys: ['name', 'synonyms'],
      threshold: 0.4,
      includeScore: true
    });
  }

  private async createWorker(): Promise<Worker> {
    const worker = await createWorker('fra');
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO_OSD,
      tessedit_ocr_engine_mode: OEM.LSTM_ONLY,
      preserve_interword_spaces: '1',
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-.,:;/\\()[]{}<>@#$%^&*_+=|~`\'" ',
    });
    return worker;
  }

  private async getWorker(): Promise<Worker> {
    if (this.workerPool.length < this.MAX_WORKERS) {
      const newWorker = await this.createWorker();
      this.workerPool.push(newWorker);
      return newWorker;
    }
    return this.workerPool[Math.floor(Math.random() * this.workerPool.length)];
  }

  public async processDocument(imagePath: string, debug = false): Promise<ExpenseQuotationOcrResponse> {
    const startTime = Date.now();
    
    try {
      if (!existsSync(imagePath)) {
        throw new Error('File not found');
      }

      const { text, confidence } = await this.extractTextWithRetry(imagePath);
      this.lastConfidence = confidence;

      const preProcessedText = this.preprocessText(text);
      const { correctedText, corrections } = this.correctFieldNames(preProcessedText);
      
      const { articles, remainingText } = this.extractArticles(correctedText);
      const recognizedFields = this.analyzeFieldRecognition(remainingText);
      const structuredData = this.structureRecognizedData(remainingText, recognizedFields, articles);
      
      const overallConfidence = this.calculateConfidence(recognizedFields, articles.length > 0);

      const response: ExpenseQuotationOcrResponse = {
        success: true,
        data: structuredData,
        recognitionDetails: debug ? recognizedFields : undefined,
        corrections: corrections.length > 0 ? corrections : undefined,
        confidence: overallConfidence,
        processingTime: Date.now() - startTime,
        message: 'Expense quotation processed successfully'
      };

      if (debug) {
        response.debug = {
          ocrText: text,
          preProcessedText,
          correctedText,
          warnings: overallConfidence < 70 ? ['Low confidence score'] : []
        };
      }

      return response;
    } catch (error) {
      this.logger.error(`Document processing failed: ${error.message}`);
      return {
        success: false,
        data: {},
        confidence: 0,
        processingTime: Date.now() - startTime,
        message: error.message
      };
    }
  }

  private preprocessText(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\s+/g, ' ')
      .replace(/([a-zA-Z])(\d)/g, '$1 $2')
      .replace(/(\d)([a-zA-Z])/g, '$1 $2')
      .replace(/([€$])\s*(\d)/g, '$1$2')
      .replace(/(\d)\s*([€$])/g, '$1$2');
  }

  private correctFieldNames(text: string): { correctedText: string; corrections: CorrectionLog[] } {
    const corrections: CorrectionLog[] = [];
    let correctedText = text;
    const correctionMap = new Map<string, string>();

    this.fieldConfigs.forEach(fieldConfig => {
      fieldConfig.synonyms.forEach(synonym => {
        correctionMap.set(synonym.toLowerCase(), fieldConfig.name);
      });
    });

    const matches: Array<{term: string; index: number}> = [];
    correctionMap.forEach((correctedTerm, synonym) => {
      const regex = new RegExp(`\\b${synonym}\\b`, 'gi');
      let match;
      while ((match = regex.exec(text)) !== null) {
        matches.push({
          term: match[0],
          index: match.index
        });
      }
    });

    matches.sort((a, b) => b.index - a.index);

    matches.forEach(({term, index}) => {
      const lowerTerm = term.toLowerCase();
      if (correctionMap.has(lowerTerm)) {
        const correctedTerm = correctionMap.get(lowerTerm);
        correctedText = correctedText.substring(0, index) + 
                       correctedTerm + 
                       correctedText.substring(index + term.length);
        
        corrections.push({
          original: term,
          corrected: correctedTerm,
          field: correctedTerm,
          confidence: 0.9,
          context: ['semantic-correction']
        });
      }
    });

    return { correctedText, corrections };
  }

  private extractArticles(text: string): { 
    articles: Article[]; 
    confidence: number;
    remainingText: string;
  } {
    const tableHeaderRegex = /(désignation|description|libellé|produit|service)[\s\t]*(quantité|qte|qty)[\s\t]*(prix|pu|unité|unitaire)[\s\t]*(total|montant)/i;
    const tableMatch = tableHeaderRegex.exec(text);
    
    if (!tableMatch) return { 
      articles: [], 
      confidence: 0,
      remainingText: text 
    };

    const tableStart = tableMatch.index;
    const nextSection = text.indexOf('\n\n', tableStart);
    const tableEnd = nextSection > 0 ? nextSection : text.length;
    const tableText = text.substring(tableStart, tableEnd);
    const remainingText = text.substring(0, tableStart) + text.substring(tableEnd);

    const articles: Article[] = [];
    const lines = tableText.split('\n');

    const headerLine = lines.find(line => tableHeaderRegex.test(line));
    if (!headerLine) return { 
      articles: [], 
      confidence: 0,
      remainingText 
    };

    const headers = headerLine.toLowerCase().split(/\s{2,}|\t/).map(h => h.trim());
    const descIndex = headers.findIndex(h => ['désignation', 'description', 'libellé', 'produit', 'service'].includes(h));
    const qtyIndex = headers.findIndex(h => ['quantité', 'qte', 'qty'].includes(h));
    const priceIndex = headers.findIndex(h => ['prix', 'pu', 'unité', 'unitaire'].includes(h));
    const totalIndex = headers.findIndex(h => ['total', 'montant'].includes(h));

    if (descIndex === -1 || qtyIndex === -1 || priceIndex === -1) {
      return { 
        articles: [], 
        confidence: 0,
        remainingText 
      };
    }

    for (let i = lines.indexOf(headerLine) + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || /^(sous-total|total|tva|montant)/i.test(line)) continue;

      const cols = line.split(/\s{2,}|\t/).filter(c => c.trim());
      if (cols.length >= 3) {
        try {
          const article: Article = {
            description: cols[descIndex].trim(),
            quantity: this.parseNumber(cols[qtyIndex]),
            unitPrice: this.parseNumber(cols[priceIndex].replace(/[^\d,.-]/g, '')),
            total: 0
          };

          if (totalIndex !== -1 && cols[totalIndex]) {
            article.total = this.parseNumber(cols[totalIndex]);
          } else {
            article.total = article.quantity * article.unitPrice;
          }

          articles.push(article);
        } catch (e) {
          this.logger.warn(`Failed to parse article line: ${line}`);
        }
      }
    }

    return { 
      articles, 
      confidence: articles.length ? Math.min(95 + (articles.length * 0.5), 100) : 0,
      remainingText
    };
  }

  private analyzeFieldRecognition(text: string): FieldRecognitionResult[] {
    return this.fieldConfigs.map(fieldConfig => {
      const recognizedSynonyms = fieldConfig.synonyms.filter(synonym => 
        new RegExp(`\\b${synonym}\\b`, 'i').test(text)
      );
  
      const patterns = fieldConfig.patterns.map(pattern => {
        const match = pattern.regex.exec(text);
        const matched = match !== null;
        
        let confidenceBoost = 0;
        if (matched && pattern.example) {
          const exampleKey = pattern.example.split(':')[0]?.trim().toLowerCase();
          const matchedKey = match[0]?.split(':')[0]?.trim().toLowerCase();
          if (exampleKey && matchedKey && exampleKey.includes(matchedKey)) {
            confidenceBoost = 0.3;
          }
        }
  
        return {
          matched,
          pattern: pattern.example,
          priority: pattern.priority,
          matchedText: match ? match[0] : undefined,
          confidenceBoost
        };
      });
  
      const baseConfidence = (recognizedSynonyms.length > 0 ? 0.4 : 0) + 
                           (patterns.some(p => p.matched) ? 0.6 : 0);
      
      const confidence = baseConfidence + 
                        patterns.reduce((sum, p) => sum + (p.confidenceBoost || 0), 0);
  
      return {
        fieldName: fieldConfig.name,
        confidence: Math.min(1, confidence),
        synonyms: recognizedSynonyms,
        patterns
      };
    }).sort((a, b) => b.confidence - a.confidence);
  }

  private structureRecognizedData(
    text: string, 
    recognizedFields: FieldRecognitionResult[],
    articles: Article[]
  ): Record<string, { value: any; confidence: number }> {
    const data: Record<string, { value: any; confidence: number }> = {};

    recognizedFields.forEach(field => {
      const value = this.extractFieldValue(text, field);
      if (value !== null && value !== undefined) {
        data[field.fieldName] = { 
          value, 
          confidence: Math.round(field.confidence * 100)
        };
      }
    });

    if (articles.length > 0) {
      data['articles'] = {
        value: articles,
        confidence: Math.min(95 + (articles.length * 0.5), 100)
      };
    }

    return data;
  }

  private extractFieldValue(text: string, field: FieldRecognitionResult): any {
    const fieldConfig = this.fieldConfigs.find(f => f.name === field.fieldName);
    if (!fieldConfig) return null;

    for (const pattern of fieldConfig.patterns.sort((a, b) => a.priority - b.priority)) {
      const match = pattern.regex.exec(text);
      if (match) {
        let value = match[pattern.valueGroup ?? 0]?.trim();
        if (value && pattern.valueProcessor) {
          return pattern.valueProcessor(value);
        }
        return value;
      }
    }
    return null;
  }

  private calculateConfidence(recognizedFields: FieldRecognitionResult[], hasArticles: boolean): number {
    const weights = {
      reference: 0.15,
      date: 0.15,
      client: 0.1,
      total: 0.2,
      subTotal: 0.15,
      vat: 0.1,
      paymentTerms: 0.05,
      articles: hasArticles ? 0.1 : 0
    };

    let totalWeight = 0;
    let weightedSum = 0;

    recognizedFields.forEach(field => {
      if (this.extractFieldValueFromResults(field) && weights[field.fieldName]) {
        weightedSum += field.confidence * 100 * weights[field.fieldName];
        totalWeight += weights[field.fieldName];
      }
    });

    return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  }

  private extractFieldValueFromResults(field: FieldRecognitionResult): boolean {
    return field.patterns.some(p => p.matched);
  }

  private async extractTextWithRetry(imagePath: string, retries = 2): Promise<{
    text: string;
    confidence: number;
  }> {
    let lastError: Error;

    for (let i = 0; i < retries; i++) {
      try {
        const worker = await this.getWorker();
        const { data } = await worker.recognize(imagePath);
        return {
          text: data.text,
          confidence: data.confidence
        };
      } catch (error) {
        lastError = error;
        this.logger.warn(`OCR attempt ${i + 1} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
      }
    }

    throw lastError;
  }

  public cleanupFile(path: string): void {
    try {
      if (existsSync(path)) {
        unlinkSync(path);
      }
    } catch (err) {
      this.logger.error(`Failed to delete file ${path}: ${err.message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      this.workerPool.map(worker => worker?.terminate())
    );
    this.workerPool = [];
  }
}