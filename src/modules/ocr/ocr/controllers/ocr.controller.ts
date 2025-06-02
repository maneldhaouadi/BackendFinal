import { Controller, Post, UploadedFile, UseInterceptors, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OcrService } from '../services/ocr.service';
import { InvoiceData } from '../services/ocr.service';
import * as fs from 'fs';
import * as path from 'path';

@Controller('ocr')
export class OcrController {
  constructor(private readonly ocrService: OcrService) {}

  @Post('invoice')
  @UseInterceptors(FileInterceptor('file', {
    dest: './uploads',
    limits: {
      fileSize: 1024 * 1024 * 5, // 5MB
    },
    fileFilter: (req, file, cb) => {
      if (file.mimetype.match(/\/(jpg|jpeg|png|pdf)$/)) {
        cb(null, true);
      } else {
        cb(new Error('Seuls les fichiers JPG, JPEG, PNG et PDF sont autorisés'), false);
      }
    }
  }))
  async processInvoice(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { saveToDb?: boolean }
  ): Promise<{ success: boolean; data: InvoiceData; message: string }> {
    try {
      if (!file) {
        throw new Error('Aucun fichier téléchargé');
      }

      const text = await this.ocrService.extractTextFromImage(file.path);
      const invoiceData = await this.ocrService.parseInvoice(text);

      // Sauvegarde facultative en base de données
      if (body.saveToDb) {
        // Implémentez votre logique de sauvegarde ici
      }

      // Nettoyage du fichier temporaire
      fs.unlink(file.path, (err) => {
        if (err) console.error('Erreur suppression fichier temporaire:', err);
      });

      return {
        success: true,
        data: invoiceData,
        message: 'Facture traitée avec succès'
      };
    } catch (error) {
      // Nettoyage en cas d'erreur
      if (file?.path) {
        fs.unlink(file.path, (err) => {
          if (err) console.error('Erreur suppression fichier temporaire:', err);
        });
      }

      throw error;
    }
  }


}

