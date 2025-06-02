// src/modules/expense-quotation/services/pdf-expense-payment-extractor.service.ts
import { Injectable, Logger, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { ImportExpensePaymentDto } from '../dtos/import-expense-payment.dto';
import { DISCOUNT_TYPES } from 'src/app/enums/discount-types.enum';
import { EXPENSQUOTATION_STATUS } from 'src/modules/expense_quotation/enums/expensquotation-status.enum';

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
export class PdfExpensePaymentExtractorService {
  private readonly logger = new Logger(PdfExpensePaymentExtractorService.name);
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
      extractedData?: ImportExpensePaymentDto;
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
    return fullText.split(/\f/).filter(page => page.trim().length > 0);
  }

 private parseContentToDto(text: string): ImportExpensePaymentDto {
    // Normalisation du texte pour faciliter l'extraction
    const normalizedText = text.replace(/\s+/g, ' ').replace(/[:.]\s/g, ': ');
    
    const extractField = (patterns: RegExp[]): string | undefined => {
        for (const pattern of patterns) {
            const match = normalizedText.match(pattern);
            if (match && match[1]) return match[1].trim();
        }
        return undefined;
    };

    // Extraction spécifique pour le numéro de facture qui peut avoir différents formats
    const sequential = extractField([
        /(?:Facture|FACTURE|Invoice)\s*(?:N°|No|Numéro)?\s*[:]?\s*([A-Z0-9\-\.\/]+)/i,
        /(?:Réf|Ref|Reference)\s*[:]?\s*([A-Z0-9\-\.\/]+)/i,
        /(?:N°)\s*(\S+)/i
    ]);

    // Extraction des dates avec différents formats
    const dateStr = extractField([
        /Date\s*[:]?\s*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i,
        /Émis le\s*[:]?\s*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i,
        /(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/
    ]);
    
    const dueDateStr = extractField([
        /Échéance\s*[:]?\s*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i,
        /Date d'échéance\s*[:]?\s*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i,
        /À payer avant\s*[:]?\s*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i
    ]);

    // Extraction des montants
    const totalAmount = extractField([
        /Total\s*[:]?\s*([\d\s,.]+\s?[€$£]?)/i,
        /Montant total\s*[:]?\s*([\d\s,.]+\s?[€$£]?)/i,
        /TOTAL\s*[:]?\s*([\d\s,.]+\s?[€$£]?)/i
    ]);

    const subTotal = extractField([
        /Sous-total\s*[:]?\s*([\d\s,.]+\s?[€$£]?)/i,
        /Subtotal\s*[:]?\s*([\d\s,.]+\s?[€$£]?)/i
    ]);

    const taxStamp = extractField([
        /Timbre fiscal\s*[:]?\s*([\d\s,.]+)/i,
        /Tax stamp\s*[:]?\s*([\d\s,.]+)/i
    ]);

    const discount = extractField([
        /Remise\s*[:]?\s*([\d\s,.]+)/i,
        /Discount\s*[:]?\s*([\d\s,.]+)/i
    ]);

    const discountType = extractField([
        /Type de remise\s*[:]?\s*(\w+)/i,
        /Discount type\s*[:]?\s*(\w+)/i,
        /Remise\s*[:]?\s*[\d\s,.]+?\s*\((?:Type|Typee)\s*[:]?\s*(\w+)\)/i
    ]);

    // Extraction des champs texte
    const object = extractField([
        /Objet\s*[:]?\s*(.*?)(?=\s*(?:Sous-total|Total|Conditions|$))/i,
        /Object\s*[:]?\s*(.*?)(?=\s*(?:Subtotal|Total|Conditions|$))/i
    ]);

    const generalConditions = extractField([
        /Conditions générales\s*[:]?\s*(.*?)(?=\s*(?:Notes|Total|$))/i,
        /General conditions\s*[:]?\s*(.*?)(?=\s*(?:Notes|Total|$))/i
    ]);

    const notes = extractField([
        /Notes\s*[:]?\s*(.*)/i,
        /Remarques\s*[:]?\s*(.*)/i
    ]);

    return {
        sequential: sequential,
        date: dateStr ? this.parseDate(dateStr) : undefined,
        dueDate: dueDateStr ? this.parseDate(dueDateStr) : undefined,
        object: object,
        generalConditions: generalConditions,
        taxStamp: this.parseNumber(taxStamp),
        discount: this.parseNumber(discount),
        discount_type: this.parseDiscountType(discountType),
        subTotal: this.parseNumber(subTotal),
        total: this.parseNumber(totalAmount),
        notes: notes
    };
}
  private parseNumber(value?: string): number | undefined {
    if (!value) return undefined;
    const num = parseFloat(value.replace(',', '.').replace(/[^\d.-]/g, ''));
    return isNaN(num) ? undefined : num;
  }

  private parseDate(dateStr: string): Date | undefined {
    if (!dateStr) return undefined;
    try {
      const [day, month, year] = dateStr.split(/[\/.-]/);
      return new Date(`${year}-${month}-${day}`);
    } catch (e) {
      return undefined;
    }
  }

  private parseDiscountType(type?: string): DISCOUNT_TYPES | undefined {
    if (!type) return undefined;
    if (type.toLowerCase().includes('percent') || type.toLowerCase().includes('pourcent')) {
      return DISCOUNT_TYPES.PERCENTAGE;
    }
    return DISCOUNT_TYPES.AMOUNT;
  }

  private validatePdfBuffer(buffer: Buffer): void {
    if (!buffer || buffer.length < 4 || buffer.slice(0, 4).toString('ascii') !== '%PDF') {
      throw new BadRequestException('Invalid PDF file');
    }
  }
}