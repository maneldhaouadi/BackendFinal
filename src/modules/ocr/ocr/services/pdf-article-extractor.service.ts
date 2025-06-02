import { Injectable, Logger, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { ImportArticleDto } from '../dtos/import-article.dto';

interface IPDFPageText { R: Array<{ T: string }>; }
interface IPDFPage { Texts?: IPDFPageText[]; }
interface IPDFData { Pages?: IPDFPage[]; }
interface IPDFParser {
  new (options?: any, version?: number): IPDFParser;
  on(event: string, callback: (...args: any[]) => void): this;
  once(event: string, callback: (...args: any[]) => void): this;
  parseBuffer(buffer: Buffer): void;
  removeAllListeners(event?: string): this;
}

const PDFParser: IPDFParser = require('pdf2json');

@Injectable()
export class PdfArticleExtractorService {
  private readonly logger = new Logger(PdfArticleExtractorService.name);
  private pdfParser: IPDFParser | null = null;

  constructor() { this.initializeParser(); }

  private initializeParser(): void {
    this.pdfParser = new PDFParser(null, 1);
    this.pdfParser.on('pdfParser_dataError', err => this.logger.error('PDF Parse Error', err));
    this.pdfParser.on('error', err => this.logger.error('PDF System Error', err));
  }

  async extractStructuredData(pdfBuffer: Buffer, fileName: string): Promise<{
    success: boolean;
    fileName: string;
    totalPages: number;
    pages: Array<{
      id: number;
      name: string;
      contentLength: number;
      preview: string;
      extractedData?: ImportArticleDto;
    }>;
    metadata: {
      extractionDate: Date;
      source: string;
    };
  }> {
    try {
      this.validatePdfBuffer(pdfBuffer);
      const rawText = await this.extractRawText(pdfBuffer);
      const pages = this.splitTextToPages(rawText);

      return {
        success: true,
        fileName,
        totalPages: pages.length,
        pages: pages.map((pageContent, index) => {
          const extractedData = this.parseContentToDto(pageContent);
          return {
            id: index + 1,
            name: `${fileName.replace('.pdf', '')}-Page_${index + 1}`,
            contentLength: pageContent.length,
            preview: pageContent.substring(0, 100) + (pageContent.length > 100 ? '...' : ''),
            extractedData
          };
        }),
        metadata: {
          extractionDate: new Date(),
          source: fileName
        }
      };
    } catch (error) {
      this.logger.error('Extraction failed', error.stack);
      throw new BadRequestException('PDF processing failed');
    }
  }

  private async extractRawText(pdfBuffer: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      this.pdfParser!.once('pdfParser_dataReady', (pdfData: IPDFData) => {
        try {
          resolve(this.processPdfData(pdfData));
        } catch (error) {
          reject(error);
        }
      });
      this.pdfParser!.parseBuffer(pdfBuffer);
    });
  }

  private processPdfData(pdfData: IPDFData): string {
    if (!pdfData.Pages?.length) return '';
    return pdfData.Pages
      .flatMap(page => page.Texts || [])
      .map(text => text.R?.map(r => decodeURIComponent(r.T)).join('') || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private splitTextToPages(fullText: string): string[] {
    // Implémentation basique - à adapter selon votre structure PDF
    return fullText.split(/\f/).filter(page => page.trim().length > 0);
  }

  private parseContentToDto(text: string): ImportArticleDto {
    const extractField = (pattern: RegExp): string | undefined => {
        const match = text.match(pattern);
        return match?.[1]?.trim();
    };

    // Extraction spécifique pour les notes pour éviter la duplication
    const notesMatch = text.match(/Notes\s*[:.-]?\s*(.*?)(?=\s*(?:Titre|R[ée]f[ée]rence|Description|Quantit[ée]|Prix|$))/is);
    const notes = notesMatch?.[1]?.trim();

    return {
        title: extractField(/Titre\s*[:.-]?\s*(.*?)(?=\s*(?:Description|Référence|$))/i),
        description: extractField(/Description\s*[:.-]?\s*(.*?)(?=\s*(?:R[ée]f[ée]rence|Quantit[ée]|Prix|$))/i),
        reference: extractField(/R[ée]f[ée]rence\s*[:.-]?\s*([A-Z0-9\s-]+)(?=\s|$)/i) || '',
        quantityInStock: this.parseNumber(extractField(/Quantit[ée]\s*(?:en stock)?\s*[:.-]?\s*(\d+)/i)),
        unitPrice: this.parseNumber(extractField(/Prix\s*(?:unitaire)?\s*[:.-]?\s*([\d,.]+)/i)),
        notes: notes,
        status: 'draft'
    };
}
  private parseNumber(value?: string): number | undefined {
    if (!value) return undefined;
    const num = parseFloat(value.replace(',', '.').replace(/[^\d.-]/g, ''));
    return isNaN(num) ? undefined : num;
  }

  private validatePdfBuffer(buffer: Buffer): void {
    if (!buffer || buffer.length < 4 || buffer.slice(0, 4).toString('ascii') !== '%PDF') {
      throw new BadRequestException('Invalid PDF file');
    }
  }
}