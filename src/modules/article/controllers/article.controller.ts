import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  NotFoundException,
  Res,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiParam, ApiConsumes, ApiBody, ApiResponse, ApiOperation } from '@nestjs/swagger';
import { PageDto } from 'src/common/database/dtos/database.page.dto';
import { ArticleService } from '../services/article.service';
import { ResponseArticleDto } from '../dtos/article.response.dto';
import { CreateArticleDto } from '../dtos/article.create.dto';
import { UpdateArticleDto } from '../dtos/article.update.dto';
import { IQueryObject } from 'src/common/database/interfaces/database-query-options.interface';
import { FileInterceptor } from '@nestjs/platform-express';
import * as path from 'path';
import { ArticleHistoryService } from 'src/modules/article-history/services/article-history.service';
import { ArticleEntity } from '../repositories/entities/article.entity';
import {  ArticleOcrService } from 'src/modules/ocr/services/articleOcrService';
import * as fs from 'fs';
import { ArticleCompareResponseDto } from '../dtos/article-compare.dto';
import { PdfExtractionService } from 'src/modules/pdf-extraction/services/pdf-extraction.service';
import { multerOptions } from 'src/configs/multer.config';

@ApiTags('article')
@Controller({
  version: '1',
  path: '/article',
})
export class ArticleController {
  constructor(
    private readonly articleService: ArticleService,
    private readonly articleOcrService: ArticleOcrService,
    private readonly pdfExtractionService: PdfExtractionService, // Ajoutez cette ligne
    private readonly articleHistoryService: ArticleHistoryService,

  ) {}


  /////////////////////////////pdf extraction 
// Dans le ArticleController
// Dans le ArticleController@Post('upload-pdf')
@Post('extract-from-pdf')
@UseInterceptors(FileInterceptor('file', multerOptions))
@ApiConsumes('multipart/form-data')
async extractFromPdf(
  @UploadedFile() file: Express.Multer.File
): Promise<CreateArticleDto> {
  if (!file) {
    throw new BadRequestException('Aucun fichier PDF fourni');
  }

  try {
    console.log('Début de l\'extraction du PDF...');
    const result = await this.pdfExtractionService.extractArticleDataFromPdf(file.path);
    
    console.log('Données extraites:', result);
    
    if (!result) {
      throw new Error("Aucune donnée extraite du PDF");
    }

    // Retourner un objet bien formé
    return {
      title: result.title || 'nn',
      description: result.description || 'nn',
      category: result.category || 'pp',
      subCategory: result.subCategory || 'pp--',
      purchasePrice: result.purchasePrice || 0,
      salePrice: result.salePrice || 0,
      quantityInStock: result.quantityInStock || 0,
      status: result.status || 'active'
    };
  } catch (error) {
    console.error('Erreur d\'extraction:', error);
    throw new BadRequestException(`Erreur d'extraction: ${error.message}`);
  } finally {
    if (file?.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  }
}

/////////////////////traduit pdf :
/*
@Post('translate-pdf')
@UseInterceptors(FileInterceptor('file', multerOptions))
@ApiConsumes('multipart/form-data')
@ApiOperation({ summary: 'Extraire, traduire et régénérer un PDF' })
async translatePdf(
  @UploadedFile() file: Express.Multer.File,
  @Query('lang') targetLang: string = 'en'
) {
  if (!file) {
    throw new BadRequestException('Aucun fichier PDF fourni');
  }

  try {
    const { original, translated, translatedPdf } = 
      await this.pdfExtractionService.extractAndTranslatePdf(file.path, targetLang);

    return {
      original,
      translated,
      pdfBase64: translatedPdf.toString('base64')
    };
  } catch (error) {
    throw new BadRequestException(`Échec de la traduction: ${error.message}`);
  } finally {
    // Nettoyage avec gestion d'erreur propre
    if (file?.path) {
      try {
        await fs.promises.unlink(file.path); // Utilisez la version Promise
      } catch (cleanupError) {
        console.error('Erreur lors du nettoyage du fichier:', cleanupError);
      }
    }
  }
}*/


  /////////////////////////

  @Post('create-from-pdf')
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Créer un article à partir des données extraites d\'un PDF' })
  @ApiResponse({
    status: 201,
    description: 'Article créé avec succès à partir du PDF',
    type: ResponseArticleDto
  })
  async createFromPdf(
    @UploadedFile() file: Express.Multer.File
  ): Promise<ResponseArticleDto> {
    try {
      if (!file) {
        throw new BadRequestException('Aucun fichier PDF n\'a été envoyé');
      }
  
      // 1. Extraire les données du PDF
      const pdfData = await this.pdfExtractionService.extractArticleDataFromPdf(file.path);
      
      // 2. Créer l'article à partir des données extraites
      const createdArticle = await this.articleService.createFromPdfData(pdfData);
  
      // 3. Retourner l'article créé
      return this.mapToResponseDto(createdArticle);
    } catch (error) {
      throw new BadRequestException(`Erreur lors de la création à partir du PDF: ${error.message}`);
    } finally {
      // Nettoyage du fichier temporaire
      if (file?.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }
  }
  

  @Post(':id/compare-with-pdf')
@UseInterceptors(FileInterceptor('file', multerOptions))
@ApiConsumes('multipart/form-data')
@ApiOperation({ summary: 'Comparer les données d\'un PDF avec un article existant' })
async compareWithPdf(
  @Param('id', ParseIntPipe) id: number,
  @UploadedFile() file: Express.Multer.File
) {
  if (!file) {
    throw new BadRequestException('Aucun fichier PDF fourni');
  }

  try {
    const result = await this.articleService.comparePdfWithArticle(id, file.path);
    
    return {
      ...result,
      articleId: id,
      pdfFileName: file.originalname
    };
  } catch (error) {
    throw new BadRequestException(error.message);
  } finally {
    // Nettoyage du fichier temporaire
    if (file?.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  }
}
  // article.controller.ts
// Dans article.controller.ts

@Post('create-from-image')
@UseInterceptors(FileInterceptor('file'))
@ApiConsumes('multipart/form-data')
@ApiBody({ 
  description: 'Image contenant les données de l\'article',
  schema: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        format: 'binary'
      }
    }
  }
})
async createFromImage(
  @UploadedFile() file: Express.Multer.File
): Promise<ResponseArticleDto> {
  try {
    if (!file) {
      throw new BadRequestException('Aucun fichier n\'a été envoyé');
    }

    // Extraire le texte et créer l'article
    const text = await this.articleOcrService.extractTextFromImage(file.path);
    const articleData = await this.articleOcrService.extractArticleData(text);
    const createdArticle = await this.articleService.createFromOcrData(articleData);

    // Convertir en DTO de réponse
    return this.mapToResponseDto(createdArticle);
  } catch (error) {
    throw new BadRequestException(error.message);
  }
}


//////////////////////////////////////////

@Post('search-by-ocr')
@UseInterceptors(FileInterceptor('file'))
@ApiConsumes('multipart/form-data')
async searchByOcrData(
  @UploadedFile() file: Express.Multer.File
): Promise<ResponseArticleDto[]> {
  if (!file) {
    throw new BadRequestException('Aucun fichier image fourni');
  }

  try {
    // Vérification du type de fichier
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Le fichier doit être une image');
    }

    // Extraction du texte
    const text = await this.articleOcrService.extractTextFromImage(file.path);
    
    // Extraction des données structurées
    const ocrData = await this.articleOcrService.extractArticleData(text);
    
    // Recherche des articles
    const articles = await this.articleService.searchByOcrData(ocrData);
    
    // Conversion en DTO
    return articles.map(article => ({
      id: article.id,
      title: article.title,
      description: article.description,
      category: article.category,
      subCategory: article.subCategory,
      purchasePrice: article.purchasePrice,
      salePrice: article.salePrice,
      quantityInStock: article.quantityInStock,
      status: article.status,
      version: article.version,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
      deletedAt: article.deletedAt,
      isDeletionRestricted: article.isDeletionRestricted,
      history: [] // Initialiser avec tableau vide si non requis
    }));

  } catch (error) {
    console.error('Erreur lors de la recherche OCR:', error);
    throw new BadRequestException(
      error.response?.message || 'Erreur lors de la recherche par OCR',
      { cause: error }
    );
  } finally {
    // Nettoyage du fichier temporaire
    if (file?.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  }
}                      

// Dans article.controller.ts@Post(':id/compare-with-image')
@Post(':id/compare-with-image')
@UseInterceptors(FileInterceptor('file'))
async compareArticleWithImage(
  @Param('id', ParseIntPipe) id: number,
  @UploadedFile() file: Express.Multer.File
): Promise<ArticleCompareResponseDto> {
  if (!file) {
    throw new BadRequestException('Aucun fichier image fourni');
  }

  try {
    // Récupérer l'article existant
    const existingArticle = await this.articleService.findOneById(id);
    
    // Comparer avec l'image (en passant directement le fichier)
    const comparisonResult = await this.articleService.compareWithImage(existingArticle, file);
    
    return {
      ...comparisonResult,
      article: this.mapToResponseDto(existingArticle)
    };
  } catch (error) {
    throw new BadRequestException(error.message);
  }
}

  //text similarity 

  // article.controller.ts

// article.controller.ts

@Get('/categories/suggest')
@ApiResponse({
  status: 200,
  description: 'Suggère des catégories similaires à la saisie',
  type: [String]
})
async suggestCategories(
  @Query('query') query: string
): Promise<string[]> {
  if (!query || query.length < 2) {
    return [];
  }
  return this.articleService.findSimilarCategories(query);
}

@Get('/subcategories/suggest')
@ApiResponse({
  status: 200,
  description: 'Suggère des sous-catégories similaires à la saisie',
  type: [String]
})
async suggestSubCategories(
  @Query('query') query: string
): Promise<string[]> {
  if (!query || query.length < 2) {
    return [];
  }
  return this.articleService.findSimilarSubCategories(query);
}

@Post('/validate-category')
@ApiBody({ schema: { type: 'object', properties: { category: { type: 'string' } } } })
async validateCategory(
  @Body() body: { category: string }
): Promise<{ valid: boolean; matches?: string[] }> {
  return this.articleService.validateCategoryUniqueness(body.category);
}

@Post('/validate-subcategory')
@ApiBody({ schema: { type: 'object', properties: { subCategory: { type: 'string' } } } })
async validateSubCategory(
  @Body() body: { subCategory: string }
): Promise<{ valid: boolean; matches?: string[] }> {
  return this.articleService.validateSubCategoryUniqueness(body.subCategory);
}



///
/////////////////////////////////////////////////////////////////
@Get('/categories/all')
@ApiResponse({
  status: 200,
  description: 'Retourne toutes les catégories disponibles',
  type: [String]
})
async getAllCategories(): Promise<string[]> {
  return await this.articleService.getAllCategories();
}

@Get('/subcategories/all')
@ApiResponse({
  status: 200,
  description: 'Retourne toutes les sous-catégories disponibles',
  type: [String]
})
async getAllSubCategories(): Promise<string[]> {
  return await this.articleService.getAllSubCategories();
}




@Get('/categories/search')
async searchCategories(
  @Query('query') query: string
): Promise<string[]> {
  const allCategories = await this.articleService.getAllCategories();
  return allCategories.filter(cat => 
    cat.toLowerCase().includes(query.toLowerCase())
  );
}



/////////////////////////////////////////////////////////

  @Post('/save-with-filter-title')
  async saveWithFilterTitle(@Body() createArticleDto: CreateArticleDto): Promise<ResponseArticleDto | { message: string }> {
    const existingArticle = await this.articleService.saveWithFilterTitle(createArticleDto);

    if (existingArticle) {
      return { message: 'L\'article avec ce titre existe déjà.' };
    }

    return await this.articleService.save(createArticleDto);
  }

  @Get('/all')
  @ApiResponse({
    status: 200,
    description: 'Retourne le nombre total d\'articles',
    schema: {
      type: 'object',
      properties: {
        total: {
          type: 'number',
          example: 104,
        },
      },
    },
  })
  async findAll(@Query() options: IQueryObject): Promise<{ total: number }> {
    return await this.articleService.findAll(options);
  }

  @Get('/list')
  async findAllPaginated(@Query() query: IQueryObject): Promise<PageDto<ResponseArticleDto>> {
    return await this.articleService.findAllPaginated(query);
  }

  @Get('/:id')
  @ApiParam({ name: 'id', type: 'number', required: true })
  async findOneById(@Param('id') id: string, @Query() query: IQueryObject): Promise<ResponseArticleDto> {
    try {
      const parsedId = parseInt(id, 10);
      if (isNaN(parsedId)) {
        throw new BadRequestException('ID doit être un nombre valide.');
      }

      query.filter ? (query.filter += `,id||$eq||${parsedId}`) : (query.filter = `id||$eq||${parsedId}`);

      return await this.articleService.findOneByCondition(query);
    } catch (error) {
      console.error('Erreur dans findOneById:', error);
      throw new BadRequestException('Erreur lors de la récupération de l\'article. Détails : ' + error.message);
    }
  }

  @Post('/save')
  async save(@Body() createArticleDto: CreateArticleDto): Promise<ResponseArticleDto> {
    return await this.articleService.save(createArticleDto);
  }

  @Put('/update/:id')
  async update(
    @Param('id') id: number,
    @Body() updateArticleDto: UpdateArticleDto,
  ): Promise<ResponseArticleDto> {
    try {
      console.log("Données reçues :", updateArticleDto); // Log des données reçues
      const updatedArticle = await this.articleService.update(id, updateArticleDto);
      if (!updatedArticle) {
        throw new NotFoundException(`Article with ID ${id} not found.`);
      }
      return updatedArticle;
    } catch (error) {
      console.error("Erreur lors de la mise à jour de l'article :", error); // Log de l'erreur
      throw new BadRequestException(error.message);
    }
  }

  @Get('/article-details/:id')
  @ApiParam({ name: 'id', type: 'number', required: true })
  async getArticleDetails(@Param('id') id: number): Promise<ResponseArticleDto> {
    try {
      if (isNaN(id)) {
        throw new BadRequestException('ID doit être un nombre valide.');
      }

      const article = await this.articleService.getArticleDetails(id);

      if (!article) {
        throw new NotFoundException('Aucun article trouvé avec cet ID.');
      }

      return article;
    } catch (error) {
      console.error('Erreur dans getArticleDetails:', error);
      throw new BadRequestException('Erreur lors de la récupération des détails de l\'article.');
    }
  }

  @Delete('/delete/:id')
  @ApiParam({ name: 'id', type: 'number', required: true })
  async delete(@Param('id') id: number): Promise<ResponseArticleDto> {
    return await this.articleService.softDelete(id);
  }/*

  @Post('import-csv')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  async importCSV(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Aucun fichier n\'a été envoyé');
    }

    const fileExtension = path.extname(file.originalname).toLowerCase();
    if (fileExtension !== '.csv') {
      throw new BadRequestException('Seuls les fichiers CSV sont autorisés');
    }

    try {
      const importedArticles = await this.articleService.importCSV(file);
      return {
        message: `${importedArticles.length} articles ont été importés avec succès.`,
        data: importedArticles,
      };
    } catch (error) {
      console.error('Erreur lors de l\'importation du fichier CSV:', error);
      throw new BadRequestException('Une erreur est survenue lors de l\'importation du fichier CSV');
    }
  }
*/
  @Post('import-excel')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  async importExcel(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Aucun fichier n\'a été envoyé.');
    }

    if (!file.mimetype.includes('excel') && !file.mimetype.includes('spreadsheet')) {
      throw new BadRequestException('Seuls les fichiers Excel sont autorisés.');
    }

    try {
      const result = await this.articleService.importExcel(file);
      return result;
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Get(':id/history')
  @ApiParam({ name: 'id', type: 'number', required: true })
  async getArticleHistory(@Param('id') id: number): Promise<any[]> {
    const historyEntries = await this.articleService.getArticleHistory(id);
    return historyEntries.map((entry) => ({
      version: entry.version,
      changes: entry.changes,
      date: entry.date,
    }));
  }

  @Get(':id/sales-performance')
  @ApiParam({ name: 'id', type: 'number' })
  async getSalesPerformance(@Param('id') id: number) {
    return this.articleService.getSalesPerformance(id);
  }
/*
  @Get('popular')
  async getPopularArticles(@Query('limit') limit: number = 10) {
    return this.articleService.getPopularArticles(limit);
  }

  @Get('stagnant')
  async getStagnantArticles(@Query('limit') limit: number = 10) {
    return this.articleService.getStagnantArticles(limit);
  }

  @Post(':id/optimize-stock')
  @ApiParam({ name: 'id', type: 'number' })
  async optimizeStock(@Param('id') id: number, @Body('newStockLevel') newStockLevel: number) {
    return this.articleService.optimizeStock(id, newStockLevel);
  }

  @Post(':id/adjust-price')
  @ApiParam({ name: 'id', type: 'number' })
  async adjustPrice(@Param('id') id: number, @Body('newPrice') newPrice: number) {
    return this.articleService.adjustPrice(id, newPrice);
  }

  @Get('stock-alerts')
  async getStockAlerts(@Query('threshold') threshold: number = 10) {
    return this.articleService.getStockAlerts(threshold);
  }

  @Get('promotion-recommendations')
  async getPromotionRecommendations() {
    return this.articleService.getPromotionRecommendations();
  }

  @Get('analyze-levels/:id')
  @ApiParam({ name: 'id', type: 'number', required: true, description: 'ID de l\'article à analyser' })
  async analyzeArticlesByLevels(@Param('id') id: string): Promise<{ message: string; data: any }> {
    try {
      const parsedId = parseInt(id, 10);
      if (isNaN(parsedId)) {
        throw new BadRequestException('ID doit être un nombre valide.');
      }

      return await this.articleService.analyzeArticlesByLevels(parsedId);
    } catch (error) {
      console.error('Erreur dans analyzeArticlesByLevels:', error);
      throw new BadRequestException('Erreur lors de l\'analyse des articles. Détails : ' + error.message);
    }
  }*/





    ////////////////////////////////////////////////////////////////////////////////
    @Post('/:id/restore-version/:version')
    @ApiParam({ name: 'id', type: 'number', required: true })
    @ApiParam({ name: 'version', type: 'number', required: true })
    @ApiResponse({
      status: 200,
      description: 'Version de l\'article restaurée avec succès',
      type: ResponseArticleDto
    })
    @ApiResponse({
      status: 404,
      description: 'Article ou version non trouvée'
    })
    async restoreArticleVersion(
      @Param('id', ParseIntPipe) id: number,
      @Param('version', ParseIntPipe) version: number
    ): Promise<ResponseArticleDto> {
      try {
        const article = await this.articleService.restoreArticleVersion(id, version);
        return this.mapToResponseDto(article);
      } catch (error) {
        if (error instanceof NotFoundException) {
          throw new NotFoundException(error.message);
        }
        throw new BadRequestException('Erreur lors de la restauration de la version');
      }
    }
    
    @Get('/:id/versions')
    @ApiParam({ name: 'id', type: 'number', required: true })
    @ApiResponse({
      status: 200,
      description: 'Liste des versions disponibles pour l\'article',
      schema: {
        type: 'object',
        properties: {
          versions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                version: { type: 'number' },
                date: { type: 'string', format: 'date-time' }
              }
            }
          }
        }
      }
    })
    @ApiResponse({
      status: 404,
      description: 'Article non trouvé'
    })
    async getAvailableVersions(
      @Param('id', ParseIntPipe) id: number
    ): Promise<{ versions: Array<{ version: number, date?: Date }> }> {
      try {
        const versions = await this.articleService.getAvailableVersions(id);
        return { versions };
      } catch (error) {
        if (error instanceof NotFoundException) {
          throw new NotFoundException(error.message);
        }
        throw new BadRequestException('Erreur lors de la récupération des versions');
      }
    }
    
    private mapToResponseDto(article: ArticleEntity): ResponseArticleDto {
      return {
        id: article.id,
        title: article.title,
        description: article.description,
        category: article.category,
        subCategory: article.subCategory,
        purchasePrice: Number(article.purchasePrice),
        salePrice: Number(article.salePrice),
        quantityInStock: Number(article.quantityInStock),
        status: article.status,
        version: Number(article.version),
        createdAt: article.createdAt,
        updatedAt: article.updatedAt,
        deletedAt: article.deletedAt,
        isDeletionRestricted: article.isDeletionRestricted,
        history: article.history?.map(entry => ({
          version: Number(entry.version),
          changes: entry.changes,
          date: entry.date,
        })) || [],
      };
    }
}