import { Controller, Post, UploadedFile, UseInterceptors, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as fs from 'fs';
import { ArticleData, ArticleOcrService } from '../services/articleOcrService';
import { ArticleEntity } from 'src/modules/article/repositories/entities/article.entity';
import { ArticleService } from 'src/modules/article/services/article.service';

@Controller('ocr/article')
export class ArticleOcrController {
  constructor(private readonly articleOcrService: ArticleOcrService,

    private readonly articleService: ArticleService
  ) {}


  // Dans article-ocr.controller.ts

@Post('create-from-image')
@UseInterceptors(FileInterceptor('file', {
  dest: './uploads',
  limits: { fileSize: 1024 * 1024 * 5 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.match(/\/(jpg|jpeg|png|pdf)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers JPG, JPEG, PNG et PDF sont autorisés'), false);
    }
  }
}))
async createArticleFromImage(
  @UploadedFile() file: Express.Multer.File,
): Promise<{ success: boolean; data: ArticleEntity; message: string }> {
  try {
    if (!file) {
      throw new Error('Aucun fichier téléchargé');
    }

    // Extraire le texte de l'image
    const text = await this.articleOcrService.extractTextFromImage(file.path);
    
    // Extraire les données structurées
    const articleData = await this.articleOcrService.extractArticleData(text);

    // Créer l'article dans la base de données
    const createdArticle = await this.articleService.createFromOcrData(articleData);

    // Nettoyer le fichier temporaire
    fs.unlink(file.path, (err) => {
      if (err) console.error('Erreur suppression fichier temporaire:', err);
    });

    return {
      success: true,
      data: createdArticle,
      message: 'Article créé avec succès à partir de l\'image'
    };
  } catch (error) {
    // Nettoyage en cas d'erreur
    if (file?.path) {
      fs.unlink(file.path, (err) => {
        if (err) console.error('Erreur suppression fichier temporaire:', err);
      });
    }

    return {
      success: false,
      data: null,
      message: error.message
    };
  }
}

  @Post('extract')
  @UseInterceptors(FileInterceptor('file', {
    dest: './uploads',
    limits: { fileSize: 1024 * 1024 * 5 }, // 5MB
    fileFilter: (req, file, cb) => {
      if (file.mimetype.match(/\/(jpg|jpeg|png|pdf)$/)) {
        cb(null, true);
      } else {
        cb(new Error('Seuls les fichiers JPG, JPEG, PNG et PDF sont autorisés'), false);
      }
    }
  }))
  async extractArticleData(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ success: boolean; data: ArticleData; message: string }> {
    try {
      if (!file) {
        throw new Error('Aucun fichier téléchargé');
      }

      const text = await this.articleOcrService.extractTextFromImage(file.path);
      const articleData = await this.articleOcrService.extractArticleData(text);

      // Nettoyage du fichier temporaire
      fs.unlink(file.path, (err) => {
        if (err) console.error('Erreur suppression fichier temporaire:', err);
      });

      return {
        success: true,
        data: articleData,
        message: 'Données article extraites avec succès'
      };
    } catch (error) {
      // Nettoyage en cas d'erreur
      if (file?.path) {
        fs.unlink(file.path, (err) => {
          if (err) console.error('Erreur suppression fichier temporaire:', err);
        });
      }

      return {
        success: false,
        data: null,
        message: error.message
      };
    }
  }
}