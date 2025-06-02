import { Controller, Post, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PdfExpenseQuotationExtractorService } from '../services/pdf-expense-quotation-extractor.service';

@Controller('expense-quotation-pdf')
export class PdfExpenseQuotationExtractController {
  constructor(private readonly pdfService: PdfExpenseQuotationExtractorService) {}

  @Post('extract')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (!file.originalname.match(/\.(pdf)$/i)) {
        return cb(new BadRequestException('Seuls les fichiers PDF sont autorisés'), false);
      }
      cb(null, true);
    }
  }))
  async extractExpenseQuotation(@UploadedFile() file: Express.Multer.File) {
    if (!file?.buffer) {
      throw new BadRequestException('Fichier PDF invalide');
    }
    return this.pdfService.extractStructuredData(file.buffer, file.originalname);
  }
}