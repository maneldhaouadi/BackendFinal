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
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiParam, ApiConsumes, ApiBody, ApiResponse, ApiOperation } from '@nestjs/swagger';
import { PageDto } from 'src/common/database/dtos/database.page.dto';
import { ArticleService } from '../services/article.service';
import { ResponseArticleDto } from '../dtos/article.response.dto';
import { CreateArticleDto } from '../dtos/article.create.dto';
import { UpdateArticleDto } from '../dtos/article.update.dto';
import { IQueryObject } from 'src/common/database/interfaces/database-query-options.interface';
import { FileInterceptor } from '@nestjs/platform-express';
import * as fs from 'fs';
import { ArticleCompareResponseDto } from '../dtos/article-compare.dto';
import { PdfExtractionService } from 'src/modules/pdf-extraction/services/pdf-extraction.service';
import { multerOptions } from 'src/configs/multer.config';
import { ArticleOcrService } from 'src/modules/ocr/services/articleOcrService';
import { ArticleEntity } from '../repositories/entities/article.entity';
import { ArticleStatus } from '../interfaces/article-data.interface';
///test test test 
@ApiTags('article')
@Controller({
  version: '1',
  path: '/article',
})
export class ArticleController {
  constructor(
    private readonly articleService: ArticleService,
    private readonly articleOcrService: ArticleOcrService,
    private readonly pdfExtractionService: PdfExtractionService
  ) {}

  private mapToResponseDto(entity: ArticleEntity): ResponseArticleDto {
    return {
      id: entity.id,
      title: entity.title,
      description: entity.description,
      reference: entity.reference,
      quantityInStock: entity.quantityInStock,
      unitPrice: entity.unitPrice,
      status: entity.status,
      version: entity.version,
      notes: entity.notes,
      justificatifFile: entity.justificatifFile,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      deletedAt: entity.deletedAt,
      history: entity.history?.map(history => ({
        version: history.version,
        changes: history.changes,
        date: history.date
      }))
    };
  }

/////////////status



@Post('bulk-status-update')
@ApiOperation({ summary: 'Mettre à jour le statut de plusieurs articles' })
async bulkUpdateStatus(
  @Body() body: { ids: number[], status: ArticleStatus }
) {
  const results = await Promise.all(
    body.ids.map(id => 
      this.articleService.updateStatus(id, body.status)
        .then(article => ({ id, success: true, article }))
        .catch(error => ({ id, success: false, error: error.message }))
  ));

  return {
    total: results.length,
    success: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    details: results
  };
}



/////////////////










//////////////////////////// debut stats 


  @Get('/stats/simple')
  @ApiOperation({ summary: 'Obtenir des statistiques simplifiées sur les articles' })
  async getSimpleStats() {
    return this.articleService.getSimpleStats();
  }

  @Get('/stats/stock-alerts')
  @ApiOperation({ summary: 'Obtenir les alertes de stock' })
  async getStockAlerts() {
    return this.articleService.getStockAlerts();
  }

  @Get('/stats/status-overview')
  @ApiOperation({ summary: 'Aperçu des statuts des articles' })
  async getStatusOverview() {
    return this.articleService.getStatusOverview();
  }

  //fin stats 



  //prediction 
// Dans ArticleController

@Get('stats/quality-scores')
@ApiOperation({ summary: 'Obtenir les scores de qualité des articles' })
async getQualityScores() {
  return this.articleService.getArticleQualityScores();
}

@Get('stats/suspicious-articles')
@ApiOperation({ summary: 'Détecter les articles suspects' })
async getSuspiciousArticles() {
  return this.articleService.detectSuspiciousArticles();
}

@Get('stats/price-trends')
@ApiOperation({ summary: 'Comparaison des prix anciens vs nouveaux' })
async comparePriceTrends() {
  return this.articleService.comparePriceTrends();
}

@Get('stats/stock-health')
@ApiOperation({ summary: 'État de santé global du stock' })
async getStockHealth() {
  return this.articleService.getStockHealth();
}








  ///

  @Post('/save')
  @UseInterceptors(FileInterceptor('justificatifFile'))
  @ApiOperation({ summary: 'Créer un nouvel article' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Données de l\'article à créer',
    type: CreateArticleDto,
  })
  async save(
    @UploadedFile() file: Express.Multer.File,
    @Body() createArticleDto: CreateArticleDto | CreateArticleDto[]
  ): Promise<ResponseArticleDto | ResponseArticleDto[]> {
    if (Array.isArray(createArticleDto)) {
      const articles = await this.articleService.saveMany(createArticleDto);
      return articles.map(article => this.mapToResponseDto(article));
    } else {
      const article = await this.articleService.save({
        ...createArticleDto,
        justificatifFile: file
      });
      return this.mapToResponseDto(article);
    }
  }
  
  @Post('/save-many')
  @ApiOperation({ summary: 'Créer plusieurs articles' })
  async saveMany(@Body() createArticleDtos: CreateArticleDto[]): Promise<ResponseArticleDto[]> {
    const articles = await this.articleService.saveMany(createArticleDtos);
    return articles.map(article => this.mapToResponseDto(article));
  }

  @Get('/all')
  @ApiOperation({ summary: 'Obtenir le nombre total d\'articles' })
  async findAll(@Query() options: IQueryObject): Promise<{ total: number }> {
    return await this.articleService.findAll(options);
  }

  @Get('/list')
  @ApiOperation({ summary: 'Lister les articles avec pagination' })
  async findAllPaginated(@Query() query: IQueryObject): Promise<PageDto<ResponseArticleDto>> {
    return await this.articleService.findAllPaginated(query);
  }
  
  @Put('/update/:id')
@UseInterceptors(FileInterceptor('justificatifFile'))
@ApiOperation({ summary: 'Mettre à jour un article' })
@ApiConsumes('multipart/form-data')
async update(
  @Param('id', ParseIntPipe) id: number,
  @UploadedFile() file: Express.Multer.File,
  @Body() updateArticleDto: UpdateArticleDto,
): Promise<ResponseArticleDto> {
  const updatedArticle = await this.articleService.update(id, {
    ...updateArticleDto,
    justificatifFile: file
  });
  return this.mapToResponseDto(updatedArticle);
}

  @Get('/:id')
  @ApiOperation({ summary: 'Obtenir un article par son ID' })
  @ApiParam({ name: 'id', description: 'ID de l\'article', type: Number })
  async findOneById(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: IQueryObject
  ): Promise<ResponseArticleDto> {
    query.filter = query.filter 
      ? `${query.filter},id||$eq||${id}` 
      : `id||$eq||${id}`;
    
    return this.articleService.findOneByCondition(query);
  }

  @Get('/article-details/:id')
  @ApiOperation({ summary: 'Obtenir les détails complets d\'un article' })
  @ApiParam({ name: 'id', description: 'ID de l\'article', type: Number })
  async getArticleDetails(
    @Param('id', ParseIntPipe) id: number
  ): Promise<ResponseArticleDto> {
    const article = await this.articleService.getArticleDetails(id);
    return this.mapToResponseDto(article);
  }

  @Delete('/delete/:id')
  @ApiOperation({ summary: 'Supprimer un article (soft delete)' })
  @ApiParam({ name: 'id', description: 'ID de l\'article à supprimer', type: Number })
  async delete(
    @Param('id', ParseIntPipe) id: number
  ): Promise<ResponseArticleDto> {
    const article = await this.articleService.softDelete(id);
    return this.mapToResponseDto(article);
  }

  @Post('/:id/restore-version/:version')
  @ApiOperation({ summary: 'Restaurer une version antérieure de l\'article' })
  @ApiParam({ name: 'id', description: 'ID de l\'article', type: Number })
  @ApiParam({ name: 'version', description: 'Numéro de version à restaurer', type: Number })
  async restoreArticleVersion(
    @Param('id', ParseIntPipe) id: number,
    @Param('version', ParseIntPipe) version: number
  ): Promise<ResponseArticleDto> {
    const article = await this.articleService.restoreArticleVersion(id, version);
    return this.mapToResponseDto(article);
  }

  @Get('/:id/versions')
  @ApiOperation({ summary: 'Obtenir toutes les versions disponibles d\'un article' })
  @ApiParam({ name: 'id', description: 'ID de l\'article', type: Number })
  async getAvailableVersions(
    @Param('id', ParseIntPipe) id: number
  ): Promise<{ versions: Array<{ version: number; date?: Date }> }> {
    const versions = await this.articleService.getAvailableVersions(id);
    return { versions };
  }


  ////////////////////////////////////////correction en haut 
/*
  // PDF Related Endpoints
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
      const result = await this.pdfExtractionService.extractArticleDataFromPdf(file.path);
      return {
        title: result.title || '',
        description: result.description || '',
        reference: result.reference || '',
        quantityInStock: result.quantityInStock || 0,
        status: result.status || 'draft'
      };
    } finally {
      if (file?.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }
  }

  @Post('create-from-pdf')
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Créer un article à partir des données extraites d\'un PDF' })
  async createFromPdf(
    @UploadedFile() file: Express.Multer.File
  ): Promise<ResponseArticleDto> {
    if (!file) {
      throw new BadRequestException('Aucun fichier PDF n\'a été envoyé');
    }

    try {
      const pdfData = await this.pdfExtractionService.extractArticleDataFromPdf(file.path);
      const createdArticle = await this.articleService.createFromPdfData(pdfData);
      return this.mapToResponseDto(createdArticle);
    } finally {
      if (file?.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }
  }

  @Post(':id/compare-with-pdf')
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @ApiConsumes('multipart/form-data')
  async compareWithPdf(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File
  ) {
    if (!file) {
      throw new BadRequestException('Aucun fichier PDF fourni');
    }

    try {
      return await this.articleService.comparePdfWithArticle(id, file.path);
    } finally {
      if (file?.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }
  }

  // OCR Related Endpoints
  @Post('create-from-image')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  async createFromImage(
    @UploadedFile() file: Express.Multer.File
  ): Promise<ResponseArticleDto> {
    if (!file) {
      throw new BadRequestException('Aucun fichier n\'a été envoyé');
    }

    try {
      const text = await this.articleOcrService.extractTextFromImage(file.path);
      const articleData = await this.articleOcrService.extractArticleData(text);
      const createdArticle = await this.articleService.createFromOcrData(articleData);
      return this.mapToResponseDto(createdArticle);
    } finally {
      if (file?.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }
  }

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
      const text = await this.articleOcrService.extractTextFromImage(file.path);
      const ocrData = await this.articleOcrService.extractArticleData(text);
      const articles = await this.articleService.searchByOcrData(ocrData);
      return articles.map(article => this.mapToResponseDto(article));
    } finally {
      if (file?.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }
  }

  @Post(':id/compare-with-image')
  @UseInterceptors(FileInterceptor('file'))
  async compareArticleWithImage(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File
  ): Promise<ArticleCompareResponseDto> {
    if (!file) {
      throw new BadRequestException('Aucun fichier image fourni');
    }

    const existingArticle = await this.articleService.findOneById(id);
    const comparisonResult = await this.articleService.compareWithImage(existingArticle, file);
    
    return {
      ...comparisonResult,
      article: this.mapToResponseDto(existingArticle)
    };
  }

  // Text Similarity Endpoints
  @Get('/categories/suggest')
  async suggestCategories(
    @Query('query') query: string
  ): Promise<string[]> {
    if (!query || query.length < 2) {
      return [];
    }
    return this.articleService.findSimilarCategories(query);
  }

  @Get('/subcategories/suggest')
  async suggestSubCategories(
    @Query('query') query: string
  ): Promise<string[]> {
    if (!query || query.length < 2) {
      return [];
    }
    return this.articleService.findSimilarSubCategories(query);
  }

  @Post('/validate-category')
  async validateCategory(
    @Body() body: { category: string }
  ): Promise<{ valid: boolean; matches?: string[] }> {
    return this.articleService.validateCategoryUniqueness(body.category);
  }

  @Post('/validate-subcategory')
  async validateSubCategory(
    @Body() body: { subCategory: string }
  ): Promise<{ valid: boolean; matches?: string[] }> {
    return this.articleService.validateSubCategoryUniqueness(body.subCategory);
  }

  @Get('/categories/all')
  async getAllCategories(): Promise<string[]> {
    return await this.articleService.getAllCategories();
  }

  @Get('/subcategories/all')
  async getAllSubCategories(): Promise<string[]> {
    return await this.articleService.getAllSubCategories();
  }

  // Basic CRUD Endpoints


 
 */


/*


  

 

  @Post('import-excel')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Aucun fichier n\'a été envoyé.');
    }

    if (!file.mimetype.includes('excel') && !file.mimetype.includes('spreadsheet')) {
      throw new BadRequestException('Seuls les fichiers Excel sont autorisés.');
    }

    return await this.articleService.importExcel(file);
  }

  @Get(':id/history')
  async getArticleHistory(@Param('id', ParseIntPipe) id: number): Promise<any[]> {
    return await this.articleService.getArticleHistory(id);
  }

  @Get(':id/sales-performance')
  async getSalesPerformance(@Param('id', ParseIntPipe) id: number) {
    return await this.articleService.getSalesPerformance(id);
  }

  

  private mapToResponseDto(article: ArticleEntity): ResponseArticleDto {
    return {
      id: article.id,
      title: article.title,
      description: article.description,
      reference: article.reference,
      quantityInStock: article.quantityInStock,
      status: article.status,
      version: article.version,
      notes: article.notes,
      justificatifFile: article.justificatifFile
        ? {
            data: article.justificatifFile,
            filename: article.justificatifFileName,
            mimeType: article.justificatifMimeType,
            size: article.justificatifFileSize,
          }
        : undefined,
      unitPrice: article.unitPrice,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
      deletedAt: article.deletedAt,
      history: article.history?.map(entry => ({
        version: entry.version,
        changes: entry.changes,
        date: entry.date,
      })) || [],
    };
  }
  */
}