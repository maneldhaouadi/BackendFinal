import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { createWorker, Worker, OEM, PSM } from 'tesseract.js';
import { existsSync, unlinkSync } from 'fs';
import Fuse from 'fuse.js';
import { FieldRecognitionResult, CorrectionLog } from '../dtos/ocr-result.dto';
import { PaymentOcrProcessResponse } from '../dtos/payment-ocr-result.dto';

interface FieldConfig {
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
export class PaymentOcrService implements OnModuleDestroy {
  private readonly logger = new Logger(PaymentOcrService.name);
  private workerPool: Worker[] = [];
  private readonly MAX_WORKERS = 3;
  private lastConfidence = 0;
  private fuse: Fuse<FieldConfig>;

  private readonly fieldConfigs: FieldConfig[] = [
    {
      name: 'reference',
      synonyms: ['référence', 'ref', 'numéro', 'n°', 'no', 'payment id', 'id paiement'],
      patterns: [
        {
          regex: /(?:reference|référence|ref|payment id|id paiement)\s*[:=\-]?\s*(PAY-\d{4}-\d{3,})/i,
          example: "Référence: PAY-2023-456",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => val.toUpperCase()
        },
        {
          regex: /(PAY-\d{4}-\d{3,})/i,
          example: "PAY-2023-456",
          priority: 2,
          valueGroup: 1
        }
      ]
    },
    {
      name: 'amount',
      synonyms: ['montant', 'total', 'somme', 'amount', 'sum'],
      patterns: [
        {
          regex: /(?:montant|amount|total)\s*[:=\-]?\s*(\d+[.,]\d{2})\s*(?:€|EUR|USD)?/i,
          example: "Montant: 1500.00 EUR",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => val.replace(',', '.')
        },
        {
          regex: /(\d+[.,]\d{2})\s*(?:€|EUR|USD)/i,
          example: "1500.00 EUR",
          priority: 2,
          valueGroup: 1,
          valueProcessor: (val) => val.replace(',', '.')
        }
      ]
    },
    {
      name: 'date',
      synonyms: ['date', 'date paiement', 'payment date', 'effectué le'],
      patterns: [
        {
          regex: /(?:date|date paiement|payment date)\s*[:=\-]?\s*(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/i,
          example: "Date: 15/05/2023",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => {
            const [day, month, year] = val.split(/[\/\-.]/);
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          }
        },
        {
          regex: /(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/i,
          example: "15/05/2023",
          priority: 2,
          valueGroup: 1,
          valueProcessor: (val) => {
            const [day, month, year] = val.split(/[\/\-.]/);
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          }
        }
      ]
    },
    {
      name: 'mode',
      synonyms: ['mode', 'moyen', 'payment mode', 'type paiement'],
      patterns: [
        {
          regex: /(?:mode|moyen|payment mode|type paiement)\s*[:=\-]?\s*(virement|chèque|cb|carte|espèces|transfer|cheque|card|cash)/i,
          example: "Mode: virement",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => {
            const mapping = {
              'virement': 'TRANSFER',
              'transfer': 'TRANSFER',
              'chèque': 'CHECK',
              'cheque': 'CHECK',
              'cb': 'CREDIT_CARD',
              'carte': 'CREDIT_CARD',
              'card': 'CREDIT_CARD',
              'espèces': 'CASH',
              'cash': 'CASH'
            };
            return mapping[val.toLowerCase()] || val.toUpperCase();
          }
        }
      ]
    },
    {
      name: 'currency',
      synonyms: ['devise', 'currency', 'monnaie'],
      patterns: [
        {
          regex: /(?:devise|currency|monnaie)\s*[:=\-]?\s*(EUR|USD|GBP|JPY|CHF)/i,
          example: "Devise: EUR",
          priority: 1,
          valueGroup: 1
        },
        {
          regex: /(\d+[.,]\d{2})\s*(EUR|USD|GBP|JPY|CHF)/i,
          example: "1500.00 EUR",
          priority: 2,
          valueGroup: 2
        }
      ]
    },
    {
      name: 'notes',
      synonyms: ['note', 'remarque', 'commentaire', 'details', 'détails'],
      patterns: [
        {
          regex: /(?:note|remarque|commentaire|details|détails)\s*[:=\-]?\s*([^\n]+)/i,
          example: "Note: Paiement partiel",
          priority: 1,
          valueGroup: 1
        }
      ]
    },
    {
      name: 'beneficiary',
      synonyms: ['bénéficiaire', 'beneficiary', 'destinataire', 'receiver', 'bensficiaire'],
      patterns: [
        {
          regex: /(?:bénéficiaire|beneficiary|destinataire|receiver|bensficiaire)\s*[:=\-]?\s*([^\n]+?)(?:\s*(?:IBAN|bic)|$)/i,
          example: "Bénéficiaire: Société Consulting Plus",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => val.trim()
        }
      ]
    },
    {
      name: 'iban',
      synonyms: ['iban', 'compte', 'account', 'numéro compte'],
      patterns: [
        {
          regex: /(?:IBAN|compte|account|numéro compte)\s*[:=\-]?\s*([A-Z]{2}\d{2}\s?(?:\d{4}\s?){2,}\d{4}(?:\s?\d{0,4})?)/i,
          example: "IBAN: FR76 3060 4600 0108 1234 5678 900",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => val.replace(/\s/g, '').toUpperCase()
        }
      ]
    }
  ];

  constructor() {
    this.initializeFieldSearch();
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
    //await worker.loadLanguage('fra+eng');
    //await worker.initialize('fra+eng');
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

  public async processDocument(imagePath: string, debug = false): Promise<PaymentOcrProcessResponse> {
    const startTime = Date.now();
    
    try {
      if (!existsSync(imagePath)) {
        throw new Error('File not found');
      }

      const { text, confidence } = await this.extractTextWithRetry(imagePath);
      this.lastConfidence = confidence;

      const preProcessedText = this.preprocessText(text);
      const { correctedText, corrections } = this.correctFieldNames(preProcessedText);
      const recognizedFields = this.analyzeFieldRecognition(correctedText);
      const structuredData = this.structureRecognizedData(correctedText, recognizedFields);
      const enhancedData = this.enhanceDataStructure(structuredData);
      const overallConfidence = this.calculateConfidence(recognizedFields);

      const response: PaymentOcrProcessResponse = {
        success: true,
        data: enhancedData,
        recognitionDetails: debug ? recognizedFields : undefined,
        corrections: corrections.length > 0 ? corrections : undefined,
        confidence: overallConfidence,
        processingTime: Date.now() - startTime,
        message: 'Payment document processed successfully'
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
      this.logger.error(`Payment document processing failed: ${error.message}`);
      return {
        success: false,
        data: {},
        confidence: 0,
        processingTime: Date.now() - startTime,
        message: error.message
      };
    }
  }

  private async extractTextWithRetry(imagePath: string, retries = 2): Promise<{
    text: string;
    confidence: number;
  }> {
    let lastError: Error;

    for (let i = 0; i <= retries; i++) {
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
      .replace(/^\s+|\s+$/g, '')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"');
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

  private structureRecognizedData(text: string, recognizedFields: FieldRecognitionResult[]): 
  Record<string, { value: any; confidence: number }> {
    const data: Record<string, { value: any; confidence: number }> = {};

    recognizedFields.forEach(field => {
      const value = this.extractFieldValue(text, field);
      if (value) {
        data[field.fieldName] = { 
          value, 
          confidence: Math.round(field.confidence * 100)
        };
      }
    });

    return data;
  }

  private extractFieldValue(text: string, field: FieldRecognitionResult): any {
    const fieldConfig = this.fieldConfigs.find(f => f.name === field.fieldName);
    if (!fieldConfig) return null;

    for (const pattern of fieldConfig.patterns.sort((a, b) => a.priority - b.priority)) {
      const match = pattern.regex.exec(text);
      if (match) {
        let value = match[pattern.valueGroup ?? 0]?.trim();
        
        if (pattern.valueProcessor) {
          value = pattern.valueProcessor(value);
        }
        
        return value;
      }
    }
    return null;
  }

  private enhanceDataStructure(data: Record<string, { value: any; confidence: number }>) {
    const enhancedData = { ...data };

    // Extract beneficiary and IBAN from notes if they exist
    if (enhancedData.notes && !enhancedData.beneficiary) {
      const beneficiaryMatch = /(?:bénéficiaire|beneficiary|destinataire|receiver|bensficiaire)\s*[:=\-]?\s*([^\n]+?)(?:\s*(?:IBAN|bic)|$)/i.exec(enhancedData.notes.value);
      if (beneficiaryMatch) {
        enhancedData.beneficiary = {
          value: beneficiaryMatch[1].trim(),
          confidence: Math.min(100, enhancedData.notes.confidence * 0.9)
        };
      }
    }

    if (enhancedData.notes && !enhancedData.iban) {
      const ibanMatch = /(?:IBAN|compte|account|numéro compte)\s*[:=\-]?\s*([A-Z]{2}\d{2}\s?(?:\d{4}\s?){2,}\d{4}(?:\s?\d{0,4})?)/i.exec(enhancedData.notes.value);
      if (ibanMatch) {
        enhancedData.iban = {
          value: ibanMatch[1].replace(/\s/g, '').toUpperCase(),
          confidence: Math.min(100, enhancedData.notes.confidence * 0.8)
        };
      }
    }

    // Clean up notes if they contain extracted information
    if (enhancedData.notes) {
      let cleanedNotes = enhancedData.notes.value;
      
      // Remove beneficiary info if found
      if (enhancedData.beneficiary) {
        cleanedNotes = cleanedNotes.replace(
          new RegExp(`(?:bénéficiaire|beneficiary|destinataire|receiver|bensficiaire)\\s*[:=\\-]?\\s*${enhancedData.beneficiary.value.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}`, 'i'), 
          ''
        );
      }
      
      // Remove IBAN info if found
      if (enhancedData.iban) {
        const ibanSpaced = enhancedData.iban.value.replace(/(.{4})/g, '$1 ').trim();
        cleanedNotes = cleanedNotes.replace(
          new RegExp(`(?:IBAN|compte|account|numéro compte)\\s*[:=\\-]?\\s*${ibanSpaced.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}`, 'ig'), 
          ''
        );
      }
      
      // Additional cleaning
      enhancedData.notes.value = cleanedNotes
        .replace(/^\s*s:\s*/, '') // Remove "s: " prefix
        .replace(/\s{2,}/g, ' ')
        .replace(/^[:=\-]\s*/, '')
        .trim();
    }

    // Auto-correct common beneficiary typos
    if (enhancedData.beneficiary) {
      enhancedData.beneficiary.value = enhancedData.beneficiary.value
        .replace(/^Societ\b/i, 'Société')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Ensure currency is uppercase
    if (enhancedData.currency) {
      enhancedData.currency.value = enhancedData.currency.value.toUpperCase();
    }

    // Set default mode if not detected but present in corrections
    if (!enhancedData.mode) {
      enhancedData.mode = {
        value: 'TRANSFER',
        confidence: 80
      };
    }// && this.corrections.some(c => c.field === 'mode')

    return enhancedData;
}
  private calculateConfidence(recognizedFields: FieldRecognitionResult[]): number {
    const weights = {
      reference: 0.15,
      amount: 0.25,
      date: 0.2,
      mode: 0.1,
      currency: 0.1,
      beneficiary: 0.1,
      iban: 0.05,
      notes: 0.05
    };

    let totalWeight = 0;
    let weightedSum = 0;

    recognizedFields.forEach(field => {
      if (this.extractFieldValueFromResults(field) && weights[field.fieldName]) {
        weightedSum += field.confidence * 100 * weights[field.fieldName];
        totalWeight += weights[field.fieldName];
      }
    });

    // Add base OCR confidence with a weight of 0.3
    weightedSum += this.lastConfidence * 0.3;
    totalWeight += 0.3;

    return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  }

  private extractFieldValueFromResults(field: FieldRecognitionResult): boolean {
    return field.patterns.some(p => p.matched);
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