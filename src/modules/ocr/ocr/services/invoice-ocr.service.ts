import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { createWorker, Worker, OEM, PSM } from 'tesseract.js';
import { existsSync, unlinkSync } from 'fs';
import Fuse from 'fuse.js';
import { 
  InvoiceOcrProcessResponse, 
  InvoiceFieldRecognitionResult, 
  InvoiceCorrectionLog 
} from '../dtos/invoice-ocr-result.dto';

interface InvoiceFieldConfig {
  name: string;
  synonyms: string[];
  patterns: {
    regex: RegExp;
    example: string;
    priority: number;
    valueGroup?: number;
    valueProcessor?: (value: string) => string;
  }[];
}

@Injectable()
export class InvoiceOcrService implements OnModuleDestroy {
  private readonly logger = new Logger(InvoiceOcrService.name);
  private workerPool: Worker[] = [];
  private readonly MAX_WORKERS = 3;
  private fuse: Fuse<InvoiceFieldConfig>;

  private readonly fieldConfigs: InvoiceFieldConfig[] = [
    {
      name: 'invoice_number',
      synonyms: ['numéro de facture', 'facture no', 'n° facture', 'invoice', 'ref', 'code'],
      patterns: [
        {
          regex: /(?:invoice|facture)\s*(?:no|n°|numéro)?\s*[:=\-]?\s*([A-Z]{2,}[-]\d{4}[-]\d{3,})/i,
          example: "Invoice No: INV-2024-456",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => val.toUpperCase().trim()
        },
        {
          regex: /([A-Z]{2,}[-]\d{4}[-]\d{3,})/i,
          example: "INV-2024-456",
          priority: 2,
          valueGroup: 1
        }
      ]
    },
    {
      name: 'invoice_date',
      synonyms: ['date de facture', 'date', 'issued on', 'invoice date'],
      patterns: [
        {
          regex: /(?:issued\s*on|invoice\s*date|date)\s*[:=\-]?\s*(\d{4}[\.\-\/]\d{2}[\.\-\/]\d{2})/i,
          example: "Issued on: 2024.05.20",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => this.normalizeDate(val)
        }
      ]
    },
    {
      name: 'due_date',
      synonyms: ['due date', 'échéance', 'à payer avant', 'payment due'],
      patterns: [
        {
          regex: /(?:due\s*date|payment\s*due|échéance)\s*[:=\-]?\s*(\d{4}[\.\-\/]\d{2}[\.\-\/]\d{2})/i,
          example: "Due date: 2024-06-20",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => this.normalizeDate(val)
        }
      ]
    },
    {
      name: 'total_amount',
      synonyms: ['total amount', 'total', 'montant total', 'net à payer'],
      patterns: [
        {
          regex: /(?:total\s*amount|montant\s*total|total)\s*[:=\-]?\s*([€$]?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
          example: "TOTAL AMOUNT: €2,646.00",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => parseFloat(val.replace(/[€$\s]/g, '').replace(',', '')).toFixed(2)
        }
      ]
    },
    {
      name: 'supplier_name',
      synonyms: ['supplier', 'seller', 'fournisseur', 'vendeur'],
      patterns: [
        {
          regex: /(?:supplier|seller|fournisseur)\s*[:=\-]?\s*([A-Z][a-zA-Z\s\.]+)(?=\n|$)/i,
          example: "Supplier: Global Tech Inc.",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => val.trim()
        }
      ]
    },
    {
      name: 'customer_name',
      synonyms: ['customer', 'client', 'buyer', 'acheteur'],
      patterns: [
        {
          regex: /(?:customer|client|buyer)\s*[:=\-]?\s*([A-Z][a-zA-Z\s\.]+)(?=\n|$)/i,
          example: "Customer: Acme Corporation",
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

  private normalizeDate(value: string): string {
    if (!value) return value;
    
    // Format déjà correct
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

    // Extraction des composants
    const cleanValue = value.replace(/[^\d\.\-\/]/g, '');
    const parts = cleanValue.split(/[\.\-\/]/);

    if (parts.length === 3) {
      // Format YYYY-MM-DD
      if (parts[0].length === 4) {
        return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
      }
      // Format DD-MM-YYYY
      return `20${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }

    return value;
  }

  private initializeFieldSearch() {
    this.fuse = new Fuse(this.fieldConfigs, {
      keys: ['name', 'synonyms'],
      threshold: 0.4,
      includeScore: true
    });
  }

  private async createWorker(): Promise<Worker> {
    const worker = await createWorker();
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

  public async processInvoice(imagePath: string, debug = false): Promise<InvoiceOcrProcessResponse> {
    const startTime = Date.now();
    
    try {
      if (!existsSync(imagePath)) {
        throw new Error('File not found');
      }

      const { text, confidence } = await this.extractTextWithRetry(imagePath);
      const preProcessedText = this.preprocessText(text);
      const { correctedText, corrections } = this.correctFieldNames(preProcessedText);
      const recognizedFields = this.analyzeFieldRecognition(correctedText);
      const structuredData = this.structureRecognizedData(correctedText, recognizedFields, corrections);
      const overallConfidence = this.calculateConfidence(recognizedFields, corrections, confidence);

      const response: InvoiceOcrProcessResponse = {
        success: true,
        data: structuredData,
        recognitionDetails: debug ? recognizedFields : undefined,
        corrections: corrections.length > 0 ? corrections : undefined,
        confidence: overallConfidence,
        processingTime: Date.now() - startTime,
        message: 'Invoice processed successfully'
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
      this.logger.error(`Invoice processing failed: ${error.message}`);
      return {
        success: false,
        data: {},
        confidence: 0,
        processingTime: Date.now() - startTime,
        message: error.message
      };
    }
  }

  private async extractTextWithRetry(imagePath: string, retries = 2): Promise<{ text: string; confidence: number }> {
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

  private preprocessText(text: string): string {
    return text
      .replace(/(\r\n|\n|\r)/gm, '\n')
      .replace(/\s+/g, ' ')
      .replace(/^\s+|\s+$/g, '');
  }

  private correctFieldNames(text: string): { correctedText: string; corrections: InvoiceCorrectionLog[] } {
    const corrections: InvoiceCorrectionLog[] = [];
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

  private analyzeFieldRecognition(text: string): InvoiceFieldRecognitionResult[] {
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
      
      const confidence = Math.min(1, baseConfidence + 
                          patterns.reduce((sum, p) => sum + (p.confidenceBoost || 0), 0));
  
      return {
        fieldName: fieldConfig.name,
        confidence,
        synonyms: recognizedSynonyms,
        patterns
      };
    }).sort((a, b) => b.confidence - a.confidence);
  }

  private structureRecognizedData(
    text: string, 
    recognizedFields: InvoiceFieldRecognitionResult[],
    corrections: InvoiceCorrectionLog[]
  ): Record<string, { value: any; confidence: number }> {
    const data: Record<string, { value: any; confidence: number }> = {};

    // Process recognized fields first
    recognizedFields.forEach(field => {
      const value = this.extractFieldValue(text, field);
      if (value) {
        data[field.fieldName] = { 
          value, 
          confidence: Math.min(90, Math.round(field.confidence * 100))
        };
      }
    });

    // Process corrections for missing fields
    corrections.forEach(correction => {
      if (!data[correction.field]) {
        const fieldConfig = this.fieldConfigs.find(f => f.name === correction.field);
        if (fieldConfig) {
          const value = this.extractFieldValue(text, {
            fieldName: correction.field,
            confidence: correction.confidence,
            synonyms: [],
            patterns: fieldConfig.patterns.map(p => ({
              matched: false,
              pattern: p.example,
              priority: p.priority,
              matchedText: undefined,
              confidenceBoost: 0
            }))
          });

          data[correction.field] = {
            value: value || 'FIELD_NOT_EXTRACTED',
            confidence: Math.round(correction.confidence * 100)
          };
        }
      }
    });

    return data;
  }

  private extractFieldValue(text: string, field: InvoiceFieldRecognitionResult): any {
    const fieldConfig = this.fieldConfigs.find(f => f.name === field.fieldName);
    if (!fieldConfig) return null;

    for (const pattern of fieldConfig.patterns.sort((a, b) => a.priority - b.priority)) {
      const match = pattern.regex.exec(text);
      if (match) {
        let value = match[pattern.valueGroup ?? 0]?.trim();
        if (value && pattern.valueProcessor) {
          value = pattern.valueProcessor(value);
        }
        return value;
      }
    }
    return null;
  }

  private calculateConfidence(
    recognizedFields: InvoiceFieldRecognitionResult[],
    corrections: InvoiceCorrectionLog[],
    ocrConfidence: number
  ): number {
    const fieldWeights = {
      invoice_number: 0.25,
      invoice_date: 0.2,
      due_date: 0.15,
      total_amount: 0.25,
      supplier_name: 0.075,
      customer_name: 0.075
    };

    // Calculate base confidence from recognized fields
    let weightedSum = 0;
    let totalWeight = 0;

    recognizedFields.forEach(field => {
      if (fieldWeights[field.fieldName]) {
        weightedSum += field.confidence * fieldWeights[field.fieldName];
        totalWeight += fieldWeights[field.fieldName];
      }
    });

    // Apply OCR confidence as a global factor (50% weight)
    const ocrFactor = ocrConfidence / 100;
    const baseConfidence = (weightedSum / Math.max(0.1, totalWeight)) * 0.5 + ocrFactor * 0.5;

    // Apply corrections bonus (max +20%)
    const correctionBonus = Math.min(0.2, corrections.length * 0.05);

    return Math.round(Math.min(95, (baseConfidence + correctionBonus) * 100));
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