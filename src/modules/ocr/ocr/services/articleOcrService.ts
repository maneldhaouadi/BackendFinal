import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { createWorker, Worker, OEM, PSM } from 'tesseract.js';
import { existsSync, unlinkSync } from 'fs';
import Fuse from 'fuse.js';
import { OcrProcessResponse, FieldRecognitionResult, CorrectionLog } from '../dtos/ocr-result.dto';

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
export class ArticleOcrService implements OnModuleDestroy {
  private readonly logger = new Logger(ArticleOcrService.name);
  private workerPool: Worker[] = [];
  private readonly MAX_WORKERS = 3;
  private lastConfidence = 0;
  private fuse: Fuse<FieldConfig>;

  private readonly fieldConfigs: FieldConfig[] = [
    {
      name: 'reference',
      synonyms: ['référence', 'ref', 'code', 'id', 'numéro', 'n°', 'no', 'facture'],
      patterns: [
        {
          regex: /(?:reference|référence|ref|facture)\s*[:=\-]?\s*(PROD-\d{4}-\d{3,})/i,
          example: "Reference: PROD-2624-789",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => val.toUpperCase()
        },
        {
          regex: /(PROD-\d{4}-\d{3,})/i,
          example: "PROD-2624-789",
          priority: 2,
          valueGroup: 1
        }
      ]
    },
    {
      name: 'designation',
      synonyms: ['désignation', 'description', 'titre', 'article', 'produit'],
      patterns: [
        {
          regex: /(?:titre|description|designation|désignation)\s*[:=\-]?\s*([^\n]+?)(?=\s*(?:quantité|quantite|qte|prix|price|unitaire|statut)|$)/i,
          example: "Description: Clavier gaming mécanique",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => this.cleanDesignation(val)
        },
        {
          regex: /^(?!.*(?:reference|référence|ref|quantité|quantite|qte|prix|price|unitaire|statut))([^\n]+?)(?=\s*(?:quantité|quantite|qte|prix|price|unitaire|statut)|$)/i,
          example: "Clavier gaming mécanique",
          priority: 2,
          valueGroup: 1,
          valueProcessor: (val) => this.cleanDesignation(val)
        }
      ]
    }
,    
    {
      name: 'quantity',
      synonyms: ['quantité', 'qte', 'qty', 'nombre'],
      patterns: [
        {
          regex: /(?:quantité|quantite|qte)\s*[:=\-]?\s*(\d+)/i,
          example: "Quantite: 25",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => val.replace(/\D/g, '')
        },
        {
          regex: /(?:quantity|qty)\s*[:=\-]?\s*(\d+)/i,
          example: "Qty: 25",
          priority: 2,
          valueGroup: 1,
          valueProcessor: (val) => val.replace(/\D/g, '')
        }
      ]
    },
    {
      name: 'price',
      synonyms: ['prix', 'unitaire', 'cost', 'montant', 'price'],
      patterns: [
        {
          regex: /(?:prix|price|unitaire)\s*[:=\-]?\s*(\d+[.,]\d{2})\s*(?:€|EUR|USD)?/i,
          example: "Prix unitaire: 89.99 EUR",
          priority: 1,
          valueGroup: 1,
          valueProcessor: (val) => val.replace(',', '.')
        },
        {
          regex: /(\d+[.,]\d{2})\s*(?:€|EUR|USD)/i,
          example: "89.99 EUR",
          priority: 2,
          valueGroup: 1,
          valueProcessor: (val) => val.replace(',', '.')
        }
      ]
    },
    {
      name: 'notes',
      synonyms: ['note', 'remarque', 'commentaire', 'observation'],
      patterns: [
        {
          regex: /(?:note|remarque|commentaire)\s*[:=\-]?\s*([^\n]+)/i,
          example: "Note: Produit fragile",
          priority: 1,
          valueGroup: 1
        }
      ]
    }
  ];

  constructor() {
    this.initializeFieldSearch();
  }

  private cleanDesignation(value: string): string {
    if (!value) return value;
    
    // Supprimer les autres champs qui pourraient être dans la valeur
    this.fieldConfigs.forEach(config => {
      if (config.name !== 'designation') {
        const fieldPattern = new RegExp(
          `(?:\\b${config.name}\\b|\\b${config.synonyms.join('|')}\\b)\\s*[:=\\-]?\\s*[^\\n]*`,
          'i'
        );
        value = value.replace(fieldPattern, '');
      }
    });
    
    // Supprimer les marqueurs de fin et nettoyer
    return value
      .replace(/[:=\-]\s*$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
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

  public async processDocument(imagePath: string, debug = false): Promise<OcrProcessResponse> {
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
      const overallConfidence = this.calculateConfidence(recognizedFields);

      // Post-traitement pour séparer titre et description
      if (structuredData.designation?.value) {
        const designationValue = structuredData.designation.value;
        if (designationValue.includes('designation:')) {
          const parts = designationValue.split('designation:');
          structuredData.designation.value = parts[0].trim();
          if (parts[1] && !structuredData.description) {
            structuredData.description = {
              value: parts[1].trim(),
              confidence: structuredData.designation.confidence * 0.9
            };
          }
        }
      }

      const response: OcrProcessResponse = {
        success: true,
        data: structuredData,
        recognitionDetails: debug ? recognizedFields : undefined,
        corrections: corrections.length > 0 ? corrections : undefined,
        confidence: overallConfidence,
        processingTime: Date.now() - startTime,
        message: 'Document processed successfully'
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

  private preprocessText(text: string): string {
    return text
      .replace(/(\r\n|\n|\r)/gm, '\n')
      .replace(/\s+/g, ' ')
      .replace(/^\s+|\s+$/g, '');
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
          confidence: field.confidence * 100 
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

  private calculateConfidence(recognizedFields: FieldRecognitionResult[]): number {
    const weights = {
      reference: 0.25,
      designation: 0.25,
      quantity: 0.2,
      price: 0.3
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