import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OcrService } from '../services/ocr.service';

@Controller('ocr')
export class OcrController {
  constructor(private readonly ocrService: OcrService) {}

  @Post('invoice')
  @UseInterceptors(FileInterceptor('file', {
    dest: './uploads', // Dossier de destination pour les fichiers uploadés
  }))
  async uploadInvoice(@UploadedFile() file: Express.Multer.File): Promise<any> {
    const text = await this.ocrService.extractTextFromImage(file.path);
    const invoiceData = await this.ocrService.parseInvoice(text);
    return invoiceData;
  }
}