import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { existsSync } from 'fs';
import path from 'path';
import { createWorker, OEM, PSM, Worker } from 'tesseract.js';
import nlp from 'compromise';
import compromiseDates from 'compromise-dates';
import compromiseNumbers from 'compromise-numbers';
import { default as Fuse } from 'fuse.js';
import { ConfigService } from '@nestjs/config';
import * as fastestLevenshtein from 'fastest-levenshtein';
import { IArticleOcrConfig, ICorrectionLog } from '../interfaces/ocr.interface';
import { ArticleData, ArticleStatus } from '../../article/interfaces/article-data.interface';

type FieldPattern = {
  regex: RegExp;
  field: keyof ArticleData;
};

// Extension de compromise avec les plugins
nlp.extend(compromiseDates);
nlp.extend(compromiseNumbers);

@Injectable()
export class ArticleOcrService implements OnModuleDestroy {
  private readonly logger = new Logger(ArticleOcrService.name);
  private ocrConfig: IArticleOcrConfig;
  private fuse: Fuse<{ value: keyof ArticleData; synonyms: string[] }>;
  private workerPool: Worker[];
  private readonly workerPoolSize: number;
  private readonly validImageExtensions = ['.png', '.jpg', '.jpeg', '.tiff', '.bmp', '.gif'];
  private correctionLogs: ICorrectionLog[] = [];

  constructor(private readonly configService: ConfigService) {
    this.ocrConfig = this.initializeConfig();
    this.initializeFuse();
    this.workerPoolSize = this.configService.get<number>('OCR_WORKER_POOL_SIZE') || 3;
    this.workerPool = [];
  }

  private initializeConfig(): IArticleOcrConfig {
    return {
      lang: this.configService.get<string>('OCR_LANGUAGES', 'fra+eng'),
      oem: this.configService.get<OEM>('OCR_ENGINE_MODE', OEM.LSTM_ONLY),
      psm: this.configService.get<PSM>('OCR_PAGE_SEG_MODE', PSM.AUTO),
      preserveInterwordSpaces: true,
      tesseditCharWhitelist: this.configService.get<string>(
        'OCR_CHAR_WHITELIST', 
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-.,$€%'
      ),
      errorCorrection: {
        commonErrors: this.configService.get<Record<string, string>>(
          'OCR_COMMON_ERRORS', 
          {
            'tit1e': 'title',
            'descr1ption': 'description',
            'quant1ty': 'quantity',
            'pri ce': 'price',
            'uni t': 'unit',
            'st ock': 'stock',
            'ref': 'référence',
            'r2eference': 'référence',
            'r3ference': 'référence',
            'reférence': 'référence'
          }
        ),
        minConfidence: this.configService.get<number>('OCR_MIN_CONFIDENCE', 0.7)
      },
      advancedCorrection: {
        enableContextAwareCorrection: this.configService.get<boolean>('OCR_CONTEXT_AWARE_CORRECTION', true),
        maxCorrectionDistance: this.configService.get<number>('OCR_MAX_CORRECTION_DISTANCE', 2),
        minContextMatch: this.configService.get<number>('OCR_MIN_CONTEXT_MATCH', 0.6),
        semanticGroups: {
          price: ['prix', 'cout', 'montant', 'valeur', 'tarif'],
          quantity: ['quantité', 'nombre', 'stock', 'volume', 'compte'],
          status: ['statut', 'état', 'situation', 'condition', 'disponibilité']
        }
      }
    };
  }

  private initializeFuse() {
    const expectedFields: Array<{ value: keyof ArticleData; synonyms: string[] }> = [
      { value: 'title', synonyms: ['titre', 'nom', 'intitulé'] },
      { value: 'description', synonyms: ['desc', 'détails', 'présentation'] },
      { value: 'reference', synonyms: ['ref', 'code', 'référence'] },
      { value: 'quantityInStock', synonyms: ['quantite', 'stock', 'qte'] },
      { value: 'unitPrice', synonyms: ['prix', 'cout', 'montant', 'valeur'] },
      { value: 'status', synonyms: ['statut', 'etat', 'situation'] },
      { value: 'notes', synonyms: ['remarques', 'commentaires', 'annotations'] }
    ];

    this.fuse = new Fuse(expectedFields, {
      includeScore: true,
      threshold: this.configService.get<number>('OCR_FUZZY_THRESHOLD', 0.4),
      keys: ['value', 'synonyms'],
      findAllMatches: true,
      minMatchCharLength: 3,
      ignoreLocation: true,
      shouldSort: true
    });
  }

  private normalizeFieldNames(text: string): string {
    // Correction des noms de champs mal orthographiés
    const fieldCorrections: Record<string, string> = {
      'ref': 'référence',
      'r2eference': 'référence',
      'r3ference': 'référence',
      'référence': 'référence',
      'reférence': 'référence',
      'tit1e': 'titre',
      'descr1ption': 'description',
      'quant1ty': 'quantité',
      'qte': 'quantité',
      'prix': 'prix',
      'pr1x': 'prix',
      'statut': 'statut',
      'st4tut': 'statut'
    };
  
    // Utilisation d'une expression régulière pour trouver les motifs de champs
    const fieldPattern = /(ref(?:erence)?|r[0-9]?eference|tit(?:re)?|descr(?:iption)?|quant(?:ité)?|prix|statut)/gi;
  
    return text.replace(fieldPattern, match => {
      const lowerMatch = match.toLowerCase();
      return fieldCorrections[lowerMatch] || match;
    });
  }
  
  private applyAICorrections(text: string): string {
    // Correction intelligente des valeurs des champs
    const patterns = [
      // Correction des références (ex: ABC123 au lieu de ABCI23)
      { 
        regex: /(référence\s*[:=\-]?\s*)([a-z0-9\-]+)/gi, 
        replacer: (match: string, prefix: string, value: string) => {
          const corrected = value
            .replace(/[Oo]/g, '0')
            .replace(/[lI]/g, '1')
            .replace(/[zZ]/g, '2')
            .replace(/[sS]/g, '5')
            .replace(/[bB]/g, '8');
          return prefix + corrected;
        }
      },
      // Correction des nombres (quantité, prix)
      {
        regex: /(quantité|prix|qte)\s*[:=\-]?\s*([0-9.,]+)/gi,
        replacer: (match: string, field: string, value: string) => {
          const corrected = value
            .replace(/[Oo]/g, '0')
            .replace(/[lI]/g, '1')
            .replace(/[ ,]/g, '.');
          return `${field}: ${corrected}`;
        }
      }
    ];
  
    let correctedText = text;
    for (const pattern of patterns) {
      correctedText = correctedText.replace(pattern.regex, pattern.replacer);
    }
  
    return correctedText;
  }
  
  private async getWorker(): Promise<Worker> {
    try {
      if (this.workerPool.length < this.workerPoolSize) {
        const worker = await createWorker(this.ocrConfig.lang);
        
        await worker.setParameters({
          tessedit_pageseg_mode: this.ocrConfig.psm,
          tessedit_ocr_engine_mode: this.ocrConfig.oem,
          preserve_interword_spaces: this.ocrConfig.preserveInterwordSpaces ? '1' : '0',
          tessedit_char_whitelist: this.ocrConfig.tesseditCharWhitelist
        });
        
        this.workerPool.push(worker);
        return worker;
      }
      return this.workerPool[Math.floor(Math.random() * this.workerPool.length)];
    } catch (error) {
      this.logger.error('Failed to create OCR worker', error.stack);
      throw new Error('OCR worker initialization failed');
    }
  }

  private validateImagePath(imagePath: string): void {
    if (!imagePath) {
      throw new Error('Image path is required');
    }

    if (!existsSync(imagePath)) {
      throw new Error(`Image file not found at path: ${imagePath}`);
    }

    const extension = path.extname(imagePath).toLowerCase();
    if (!this.validImageExtensions.includes(extension)) {
      throw new Error(`Unsupported image format. Supported formats: ${this.validImageExtensions.join(', ')}`);
    }
  }

  async extractTextFromImage(imagePath: string): Promise<string> {
    this.validateImagePath(imagePath);
    const worker = await this.getWorker();
    
    this.logger.log(`Processing OCR for file: ${imagePath}`);
    const { data } = await worker.recognize(imagePath);
    
    if (data.confidence < this.ocrConfig.errorCorrection.minConfidence) {
      this.logger.warn(`Low OCR confidence (${data.confidence}) for file: ${imagePath}`);
    }

    return this.postProcessText(data.text);
  }

  private postProcessText(text: string): string {
    try {
      // Normalisation des noms de champs
      let normalizedText = this.normalizeFieldNames(text);
      
      // Application des corrections IA
      normalizedText = this.applyAICorrections(normalizedText);

      let doc = nlp(normalizedText);
      
      for (const [error, correction] of Object.entries(this.ocrConfig.errorCorrection.commonErrors)) {
        const matches = doc.match(error);
        if (matches.found) {
          this.logCorrection(error, correction, [], 0.9);
          doc.replace(error, correction);
        }
      }

      if (this.ocrConfig.advancedCorrection.enableContextAwareCorrection) {
        doc = this.applyContextAwareCorrection(doc);
      }

      return doc.text()
        .replace(/\s+/g, ' ')
        .replace(/(\d)\s+([.,])\s+(\d)/g, '$1$2$3')
        .replace(/([a-zA-Z])\s+([a-zA-Z])/g, '$1$2')
        .trim();
    } catch (error) {
      this.logger.error(`Text post-processing failed: ${error.message}`, error.stack);
      return text;
    }
  }

  private applyContextAwareCorrection(doc: any): any {
    try {
      doc.numbers().forEach((num: any) => {
        const numText = num.text();
        const corrected = this.correctNumber(numText);
        if (corrected !== numText) {
          this.logCorrection(numText, corrected, ['number'], 0.85);
          num.replaceWith(corrected);
        }
      });

      doc.dates().forEach((date: any) => {
        const dateText = date.text();
        const corrected = this.correctDate(dateText);
        if (corrected !== dateText) {
          this.logCorrection(dateText, corrected, ['date'], 0.8);
          date.replaceWith(corrected);
        }
      });

      const sentences = doc.sentences();
      sentences.forEach((sentence: any) => {
        const sentenceText = sentence.text();
        const terms = sentence.terms();
        const words = terms.out('array');
        
        words.forEach((word: string, index: number) => {
          const context = this.getWordContext(words, index);
          const { correctedWord, confidence } = this.getContextualCorrection(word, context);
          
          if (correctedWord !== word) {
            this.logCorrection(word, correctedWord, context, confidence);
            terms.eq(index).replaceWith(correctedWord);
          }
        });
      });

      return doc;
    } catch (error) {
      this.logger.error('Context-aware correction failed', error.stack);
      return doc;
    }
  }

  private logCorrection(original: string, corrected: string, context: string[], confidence: number): void {
    this.correctionLogs.push({
      original,
      corrected,
      context,
      confidence,
      timestamp: new Date()
    });
  }

  getLastCorrections(): ICorrectionLog[] {
    return [...this.correctionLogs];
  }

  private getWordContext(words: string[], currentIndex: number, windowSize = 2): string[] {
    const start = Math.max(0, currentIndex - windowSize);
    const end = Math.min(words.length - 1, currentIndex + windowSize);
    return words.slice(start, end + 1).filter((_, i) => i !== currentIndex);
  }

  private getContextualCorrection(word: string, context: string[]): { correctedWord: string; confidence: number } {
    for (const [correctWord, possibleErrors] of Object.entries(this.ocrConfig.errorCorrection.commonErrors)) {
      if (possibleErrors.includes(word.toLowerCase())) {
        return { correctedWord: correctWord, confidence: 0.9 };
      }
    }

    for (const [groupName, groupWords] of Object.entries(this.ocrConfig.advancedCorrection.semanticGroups)) {
      if (groupWords.includes(word.toLowerCase())) {
        return { correctedWord: word, confidence: 1.0 };
      }

      for (const correctWord of groupWords) {
        const distance = fastestLevenshtein.distance(word.toLowerCase(), correctWord.toLowerCase());
        if (distance <= this.ocrConfig.advancedCorrection.maxCorrectionDistance) {
          const contextMatchScore = this.getContextMatchScore(context, groupWords);
          if (contextMatchScore >= this.ocrConfig.advancedCorrection.minContextMatch) {
            const confidence = 0.8 - (distance * 0.1);
            return { correctedWord: correctWord, confidence };
          }
        }
      }
    }

    return { correctedWord: word, confidence: 1.0 };
  }

  private getContextMatchScore(context: string[], semanticGroup: string[]): number {
    const matches = context.filter(ctx => 
      semanticGroup.some(word => 
        ctx.toLowerCase().includes(word.toLowerCase()) ||
        fastestLevenshtein.distance(ctx.toLowerCase(), word.toLowerCase()) <= 2
      )
    ).length;

    return matches / context.length;
  }

  private correctNumber(numText: string): string {
    const commonNumberErrors: Record<string, string> = {
      'O': '0', 'o': '0', 'l': '1', 'I': '1', 'Z': '2', 'S': '5', 'B': '8'
    };
    return numText.split('').map(char => commonNumberErrors[char] || char).join('');
  }

  private correctDate(dateText: string): string {
    return dateText
      .replace(/[Oo]/g, '0')
      .replace(/[lI]/g, '1')
      .replace(/(\d)\s+([\/-])\s+(\d)/g, '$1$2$3');
  }

  private normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\n+/g, '\n').trim();
  }

  private validateInputText(text: string): void {
    if (!text) throw new Error('Text is required');
    if (typeof text !== 'string') throw new Error('Text must be a string');
    if (text.trim().length < 10) throw new Error('Text too short (minimum 10 characters required)');
    if (text.length > 10000) throw new Error('Text too long (maximum 10000 characters allowed)');
    
    const hasIdentifiableField = ['reference', 'title', 'price', 'quantité'].some(field => 
      text.toLowerCase().includes(field)
    );
    if (!hasIdentifiableField) {
      throw new Error('Text must contain at least one identifiable field (reference, title, price or quantity)');
    }
  }

  private extractFieldAndValue(line: string): [keyof ArticleData | undefined, string | undefined] {
    const separators = [':', '=', '-', '\t', ' '];
    let bestMatch: { field?: keyof ArticleData; value?: string; score?: number } = {};

    for (const sep of separators) {
      const parts = line.split(sep).map(p => p.trim());
      if (parts.length >= 2) {
        const searchTerm = parts[0].toLowerCase();
        const result = this.fuse.search(searchTerm)[0];
        
        if (result && (!bestMatch.score || result.score < bestMatch.score)) {
          bestMatch = {
            field: result.item.value,
            value: parts.slice(1).join(sep).trim(),
            score: result.score
          };
        }
      }
    }

    return bestMatch.score ? [bestMatch.field, bestMatch.value] : [undefined, undefined];
  }

  private extractFromUnrecognizedLines(lines: string[], data: Partial<ArticleData>) {
    const patterns: FieldPattern[] = [
      { regex: /(ref(?:erence)?|r[ée]f)\s*[:=\-]?\s*([a-z0-9\-]+)/i, field: 'reference' },
      { regex: /(title|titre)\s*[:=\-]?\s*(.+)/i, field: 'title' },
      { regex: /(price|prix|cout)\s*[:=\-]?\s*([0-9]+[.,]?[0-9]*)/i, field: 'unitPrice' },
      { regex: /(q(?:uantity|te)|stock|quantit[ée])\s*[:=\-]?\s*([0-9]+)/i, field: 'quantityInStock' },
      { regex: /(description|desc)\s*[:=\-]?\s*(.+)/i, field: 'description' }
    ];
  
    for (const line of lines) {
      for (const pattern of patterns) {
        const match = line.match(pattern.regex);
        if (match && data[pattern.field] === undefined) {
          const parsedValue = this.parseFieldValue(pattern.field, match[2]);
          if (parsedValue !== undefined) {
            // Solution type-safe
            switch (pattern.field) {
              case 'reference':
              case 'title':
              case 'description':
              case 'notes':
                data[pattern.field] = parsedValue as string;
                break;
              case 'quantityInStock':
                data[pattern.field] = parsedValue as number;
                break;
              case 'unitPrice':
                data[pattern.field] = parsedValue as number;
                break;
              case 'status':
                data[pattern.field] = parsedValue as ArticleStatus;
                break;
              case 'version':
                data[pattern.field] = parsedValue as number;
                break;
            }
          }
          break;
        }
      }
    }
  }

  async extractArticleData(text: string): Promise<ArticleData> {
    try {
      this.validateInputText(text);
      this.correctionLogs = [];
  
      const normalizedText = this.normalizeLineEndings(text);
      const lines = normalizedText.split('\n');
      
      const data: Partial<ArticleData> = {
        title: '',
        description: '',
        quantityInStock: 0,
        unitPrice: 0,
        status: 'draft',
        notes: '',
        version: 1
      };
  
      const unrecognizedLines: string[] = [];
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        const [field, value] = this.extractFieldAndValue(line);
        if (field && value) {
          const parsedValue = this.parseFieldValue(field, value);
          if (parsedValue !== undefined) {
            // Solution type-safe
            switch (field) {
              case 'reference':
              case 'title':
              case 'description':
              case 'notes':
                data[field] = parsedValue as string;
                break;
              case 'quantityInStock':
                data[field] = parsedValue as number;
                break;
              case 'unitPrice':
                data[field] = parsedValue as number;
                break;
              case 'status':
                data[field] = parsedValue as ArticleStatus;
                break;
              case 'version':
                data[field] = parsedValue as number;
                break;
            }
          }
        } else {
          unrecognizedLines.push(line);
        }
      }
  
      this.extractFromUnrecognizedLines(unrecognizedLines, data);
      return this.validateArticleData(data);
    } catch (error) {
      this.logger.error(`Article data extraction failed: ${error.message}`, error.stack);
      throw new Error(`Failed to extract article data: ${error.message}`);
    }
  }

  private parseFieldValue(field: keyof ArticleData, value: string): string | number | ArticleStatus {
    try {
      switch(field) {
        case 'quantityInStock': 
          return this.parseInteger(value);
        case 'unitPrice': 
          return this.parseDecimal(value);
        case 'status': 
          return this.normalizeStatus(value);
        case 'version': 
          return this.parseVersion(value);
        default: 
          return value;
      }
    } catch (error) {
      this.logger.warn(`Failed to parse field ${field} with value ${value}: ${error.message}`);
      return undefined;
    }
  }

  private parseInteger(value: string): number {
    const int = parseInt(value.replace(/[^\d]/g, ''), 10);
    if (isNaN(int)) throw new Error('Invalid integer value');
    return int;
  }

  private parseDecimal(value: string): number {
    const decimal = parseFloat(value.replace(/[^\d.,]/g, '').replace(',', '.'));
    if (isNaN(decimal)) throw new Error('Invalid decimal value');
    return parseFloat(decimal.toFixed(2));
  }

  private parseVersion(value: string): number {
    const version = parseInt(value.replace(/[^\d]/g, ''), 10);
    return isNaN(version) ? 1 : version;
  }

  private normalizeStatus(value: string): ArticleStatus {
    const statusMap: Record<string, ArticleStatus> = {
      'actif': 'active', 'inactif': 'inactive', 'brouillon': 'draft',
      'archivé': 'archived', 'rupture': 'out_of_stock',
      'en attente': 'pending_review', 'supprimé': 'deleted'
    };

    const normalized = value.toLowerCase();
    return statusMap[normalized] || 
           (Object.values(statusMap).includes(normalized as ArticleStatus) 
            ? normalized as ArticleStatus 
            : 'draft');
  }

  private validateArticleData(data: Partial<ArticleData>): ArticleData {
    if (!data.reference) throw new Error('Reference is required');
    return {
      reference: data.reference,
      title: data.title || '',
      description: data.description || '',
      quantityInStock: data.quantityInStock || 0,
      unitPrice: data.unitPrice || 0,
      status: data.status || 'draft',
      notes: data.notes || '',
      version: data.version || 1
    };
  }

  private async cleanupWorkers() {
    const terminationPromises = this.workerPool.map(worker => 
      worker.terminate().catch(error => 
        this.logger.error('Failed to terminate worker', error.stack)
      )
    );
    await Promise.all(terminationPromises);
    this.workerPool = [];
  }

  async onModuleDestroy() {
    await this.cleanupWorkers();
  }
}