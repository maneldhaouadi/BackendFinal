// src/modules/expense-invoice/services/pdf-expense-invoice-extractor.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ExpenseInvoiceEntryDto, ImportExpenseInvoiceDto } from '../dtos/import-expense-invoice.dto';
import { EXPENSE_INVOICE_STATUS } from 'src/modules/expense-invoice/enums/expense-invoice-status.enum';


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
export class PdfExpenseInvoiceExtractorService {
  private readonly logger = new Logger(PdfExpenseInvoiceExtractorService.name);
  private pdfParser: IPDFParser;

  constructor() {
    this.initializeParser();
  }

  private initializeParser(): void {
    this.pdfParser = new PDFParser(null, 1);
    this.pdfParser.on('pdfParser_dataError', err => 
      this.logger.error('PDF Parse Error', err));
    this.pdfParser.on('error', err => 
      this.logger.error('PDF System Error', err));
  }

  async extractStructuredData(
    pdfBuffer: Buffer, 
    fileName: string
  ): Promise<{
    success: boolean;
    fileName: string;
    totalPages: number;
    pages: Array<{
      id: number;
      name: string;
      contentLength: number;
      preview: string;
      extractedData?: ImportExpenseInvoiceDto;
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
            preview: pageContent.substring(0, 100) + 
              (pageContent.length > 100 ? '...' : ''),
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
      this.pdfParser.once('pdfParser_dataReady', (pdfData: IPDFData) => {
        try {
          const text = this.processPdfData(pdfData);
          this.pdfParser.removeAllListeners();
          resolve(text);
        } catch (error) {
          reject(error);
        }
      });
      this.pdfParser.parseBuffer(pdfBuffer);
    });
  }

  private processPdfData(pdfData: IPDFData): string {
    if (!pdfData.Pages?.length) return '';
    
    return pdfData.Pages
      .flatMap(page => page.Texts || [])
      .map(text => 
        text.R?.map(r => decodeURIComponent(r.T)).join('') || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private splitTextToPages(fullText: string): string[] {
    return fullText.split(/\f/).filter(page => page.trim().length > 0);
  }

private parseContentToDto(text: string): ImportExpenseInvoiceDto {
    // Normalisation des espaces et sauts de ligne
    const normalizedText = text.replace(/\s+/g, ' ').replace(/\s-\s/g, '-');

    const extractField = (
        pattern: RegExp, 
        group = 1,
        fallback?: string
    ): string | undefined => {
        const match = normalizedText.match(new RegExp(pattern.source, pattern.flags + 's'));
        return match?.[group]?.trim() || fallback;
    };

    const extractNumber = (pattern: RegExp): number | undefined => {
        const value = extractField(pattern);
        if (!value) return undefined;
        const num = parseFloat(value.replace(',', '.').replace(/[^\d.-]/g, ''));
        return isNaN(num) ? undefined : num;
    };

    // Extraction améliorée des articles avec gestion des blocs complets
    const entries: ExpenseInvoiceEntryDto[] = [];
    const entryBlocks = normalizedText.split(/(?=Article:)/g).slice(1);
    
    entryBlocks.forEach(block => {
        // Extraction spécifique pour chaque champ dans le bloc
        const reference = extractField(/Réf:\s*([A-Z0-9-]+)/i, 1, block) 
                       || extractField(/Reference:\s*([A-Z0-9-]+)/i, 1, block)
                       || 'N/A';
        
        const description = extractField(/Article:\s*(.*?)(?=\s*(?:Réf|Reference|Prix|PU|Qté|Quantité|$))/i, 1, block);
        const unit_price = extractNumber(/(?:Prix|PU):\s*([\d,.]+)/i);
        const quantity = extractNumber(/(?:Qté|Quantité):\s*([\d,.]+)/i);

        if (description || reference !== 'N/A') {
            entries.push({
                reference: reference.includes(' ') ? reference.split(' ')[0] : reference, // Prendre première partie si espace
                description: description?.replace(/\s*(?:Réf|Reference):.*/, '').trim(), // Nettoyer la description
                unit_price,
                quantity
            });
        }
    });

    // Extraction précise du numéro séquentiel (gestion des espaces autour des tirets)
    const sequential = extractField(/(?:Facture|Invoice)\s*N°?\s*:\s*([A-Z0-9-\s]+)/i, 1)
                     ?.replace(/\s/g, ''); // Supprimer tous les espaces

    // Extraction précise de la référence fournisseur
    const interlocutorRef = extractField(/(?:Réf|Ref)\s*(?:Fournisseur|Client|Supplier)\s*:\s*([A-Z0-9-]+)/i, 1)
                          || extractField(/(?:Réf|Ref)\s*:\s*([A-Z0-9-]+)(?=\s*(?:Fournisseur|Client|Supplier|$))/i, 1);

    return {
        sequential: sequential?.split(/\s/)[0] || undefined, // Prendre première partie si espace
        date: this.parseDate(extractField(/(?:Date)\s*:\s*(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/i, 1)),
        dueDate: this.parseDate(extractField(/(?:Échéance|Due Date)\s*:\s*(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/i, 1)),
        object: extractField(/(?:Objet|Object)\s*:\s*(.*?)(?=\s*(?:Article:|Fournisseur:|Client:|Supplier:|$))/i, 1),
        notes: extractField(/(?:Notes|Remarques)\s*:\s*(.*?)(?=\s*(?:Total|$))/i, 1),
        interlocutorName: extractField(/(?:Fournisseur|Supplier|Client)\s*:\s*(.*?)(?=\s*(?:Réf|Ref|$))/i, 1),
        interlocutorReference: interlocutorRef?.split(/\s/)[0], // Prendre première partie si espace
        status: EXPENSE_INVOICE_STATUS.Draft,
        entries: entries.filter((entry, index, self) => 
            index === self.findIndex(e => 
                e.reference === entry.reference && 
                e.description === entry.description
            )
        ) // Suppression des doublons
    };
}
  private parseDate(dateStr?: string): Date | undefined {
    if (!dateStr) return undefined;
    
    try {
      const parts = dateStr.split(/[\/\-.]/);
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        return new Date(Date.UTC(year, month, day));
      }
    } catch (e) {
      return undefined;
    }
  }

  private validatePdfBuffer(buffer: Buffer): void {
    if (!buffer || buffer.length < 4 || 
        buffer.slice(0, 4).toString('ascii') !== '%PDF') {
      throw new BadRequestException('Invalid PDF file');
    }
  }
}