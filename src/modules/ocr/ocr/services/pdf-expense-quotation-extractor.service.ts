import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ImportExpenseQuotationDto } from '../dtos/import-expense-quotation.dto';
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
export class PdfExpenseQuotationExtractorService {
  private readonly logger = new Logger(PdfExpenseQuotationExtractorService.name);
  private pdfParser: IPDFParser | null = null;

  constructor() { this.initializeParser(); }

  private initializeParser(): void {
    this.pdfParser = new PDFParser(null, 1);
    this.pdfParser.on('pdfParser_dataError', err => this.logger.error('Erreur d\'analyse PDF', err));
    this.pdfParser.on('error', err => this.logger.error('Erreur système PDF', err));
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
      extractedData?: ImportExpenseQuotationDto;
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
      this.logger.error('Échec de l\'extraction', error.stack);
      throw new BadRequestException('Échec du traitement du PDF');
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

  private parseContentToDto(text: string): ImportExpenseQuotationDto {
    // Normalisation du texte pour faciliter l'extraction
    const normalizedText = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

    const extractField = (pattern: RegExp, fallbackPattern?: RegExp): string | undefined => {
      let match = normalizedText.match(pattern);
      if (!match && fallbackPattern) match = normalizedText.match(fallbackPattern);
      return match?.[1]?.trim();
    };

    const extractDateField = (pattern: RegExp): Date | undefined => {
      const match = extractField(pattern);
      if (!match) return undefined;
      
      // Conversion des dates format JJ/MM/AAAA
      const [day, month, year] = match.split('/');
      return new Date(`${year}-${month}-${day}`);
    };

    const extractBooleanField = (pattern: RegExp): boolean | undefined => {
      const match = extractField(pattern);
      if (match === undefined) return undefined;
      return match.toLowerCase() === 'oui' || match === 'true' || match === '1';
    };

    // Extraction spécifique pour chaque champ
    const sequential = extractField(/Numéro\s*:\s*([A-Z0-9-]+)/i, /Numéro\s*:\s*([A-Z0-9\s-]+)(?=\s*Date)/i);
    
    const date = extractDateField(/Date\s*:\s*(\d{2}\/\d{2}\/\d{4})/i);
    const dueDate = extractDateField(/Date d'échéance\s*:\s*(\d{2}\/\d{2}\/\d{4})/i);
    
    const object = extractField(/Objet\s*:\s*(.*?)(?=\s*(?:Statut|Conditions générales|$))/i);
    
    const generalConditions = extractField(/Conditions générales\s*:\s*(.*?)(?=\s*(?:Sous-total|Remarques|$))/is);
    
    const status = this.parseStatus(extractField(/Statut\s*:\s*(.*?)(?=\s|$)/i));
    
    const notes = extractField(/Remarques\s*:\s*(.*?)(?=\s*(?:Options|$))/is);
    
    const subTotal = this.parseNumber(extractField(/Sous-total\s*:\s*([\d,.]+)/i));
    const discount = this.parseNumber(extractField(/Remise\s*:\s*([\d,.]+)/i));
    const discountType = this.parseDiscountType(extractField(/Type de remise\s*:\s*(.*?)(?=\s|$)/i));
    const taxStamp = this.parseNumber(extractField(/Timbre fiscal\s*:\s*([\d,.]+)/i));
    const total = this.parseNumber(extractField(/Total\s*:\s*([\d,.]+)/i));

    // Extraction des options booléennes
    const showInvoiceAddress = extractBooleanField(/Afficher adresse facturation\s*:\s*(.*?)(?=\s|$)/i);
    const showDeliveryAddress = extractBooleanField(/Afficher adresse livraison\s*:\s*(.*?)(?=\s|$)/i);
    const showArticleDescription = extractBooleanField(/Afficher description articles\s*:\s*(.*?)(?=\s|$)/i);
    const hasBankingDetails = extractBooleanField(/Afficher coordonnées bancaires\s*:\s*(.*?)(?=\s|$)/i);
    const hasGeneralConditions = extractBooleanField(/Afficher conditions générales\s*:\s*(.*?)(?=\s|$)/i);
    const hasTaxStamp = extractBooleanField(/Afficher timbre fiscal\s*:\s*(.*?)(?=\s|$)/i);

    return {
      sequential,
      date,
      dueDate,
      object,
      generalConditions,
      status,
      notes,
      taxStamp,
      discount,
      discount_type: discountType,
      subTotal,
      total,
      showInvoiceAddress,
      showDeliveryAddress,
      showArticleDescription,
      hasBankingDetails,
      hasGeneralConditions,
      hasTaxStamp
    };
  }

  private parseNumber(value?: string): number | undefined {
    if (!value) return undefined;
    const num = parseFloat(value.replace(',', '.').replace(/[^\d.-]/g, ''));
    return isNaN(num) ? undefined : num;
  }

  private parseStatus(value?: string): EXPENSQUOTATION_STATUS | undefined {
    if (!value) return undefined;
    const normalized = value.toLowerCase().trim();
    if (normalized.includes('expiré') || normalized.includes('expired')) {
      return EXPENSQUOTATION_STATUS.Expired;
    }
    return EXPENSQUOTATION_STATUS.Draft;
  }

  private parseDiscountType(value?: string): DISCOUNT_TYPES | undefined {
    if (!value) return undefined;
    const normalized = value.toLowerCase().trim();
    if (normalized.includes('pourcentage') || normalized.includes('%') || normalized.includes('percentage')) {
      return DISCOUNT_TYPES.PERCENTAGE;
    }
    if (normalized.includes('montant') || normalized.includes('amount')) {
      return DISCOUNT_TYPES.AMOUNT;
    }
    return undefined;
  }

  private validatePdfBuffer(buffer: Buffer): void {
    if (!buffer || buffer.length < 4 || buffer.slice(0, 4).toString('ascii') !== '%PDF') {
      throw new BadRequestException('Fichier PDF invalide');
    }
  }
}