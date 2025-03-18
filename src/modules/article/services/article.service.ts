import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PageDto } from 'src/common/database/dtos/database.page.dto';
import { PageMetaDto } from 'src/common/database/dtos/database.page-meta.dto';
import { ArticleRepository } from '../repositories/repository/article.repository';
import { ArticleEntity } from '../repositories/entities/article.entity';
import { ResponseArticleDto } from '../dtos/article.response.dto';
import { CreateArticleDto } from '../dtos/article.create.dto';
import { UpdateArticleDto } from '../dtos/article.update.dto';
import { IQueryObject } from 'src/common/database/interfaces/database-query-options.interface';
import { FindManyOptions, FindOneOptions, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { QueryBuilder } from 'src/common/database/utils/database-query-builder';
import { Readable } from 'stream';
import * as xlsx from 'xlsx';
import { ArticleHistoryService } from 'src/modules/article-history/services/article-history.service';
import { InjectRepository } from '@nestjs/typeorm';
import { ArticleHistoryEntity } from 'src/modules/article-history/repositories/entities/article-history.entity';
import path from 'path';
import { PdfService } from 'src/common/pdf/services/pdf.service';
import * as fs from 'fs';

@Injectable()
export class ArticleService {
  constructor(
    private readonly articleRepository: ArticleRepository,
    private readonly articleHistoryService: ArticleHistoryService,
    private readonly pdfService: PdfService,
  ) {}

  /**
   * Récupère un article par son ID.
   */
  async findOneById(id: number): Promise<ArticleEntity> {
    const article = await this.articleRepository.findOneById(id);
    if (!article) {
      throw new NotFoundException('Article non trouvé');
    }
    return article;
  }

  /**
   * Récupère un article en fonction des conditions spécifiées.
   */
  async findOneByCondition(
    query: IQueryObject,
  ): Promise<ResponseArticleDto | null> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    const article = await this.articleRepository.findOne(
      queryOptions as FindOneOptions<ArticleEntity>,
    );
    if (!article) return null;
    return article;
  }

  /**
   * Récupère le nombre total d'articles.
   */
  async findAll(
    query: IQueryObject,
  ): Promise<{ total: number }> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);

    // Compter le nombre total d'articles
    const total = await this.articleRepository.getTotalCount({
      where: queryOptions.where,
    });

    return { total };
  }

  /**
   * Récupère tous les articles paginés.
   */
  async findAllPaginated(
    query: IQueryObject,
  ): Promise<PageDto<ResponseArticleDto>> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    const count = await this.articleRepository.getTotalCount({
      where: queryOptions.where,
    });

    const entities = await this.articleRepository.findAll(
      queryOptions as FindManyOptions<ArticleEntity>,
    );

    const pageMetaDto = new PageMetaDto({
      pageOptionsDto: {
        page: parseInt(query.page),
        take: parseInt(query.limit),
      },
      itemCount: count,
    });

    return new PageDto(entities, pageMetaDto);
  }

  /**
   * Enregistre plusieurs articles.
   */
  async saveMany(createArticleDtos: CreateArticleDto[]): Promise<ArticleEntity[]> {
    const articles = await Promise.all(
      createArticleDtos.map(async (dto) => {
        const article = this.articleRepository.create({
          ...dto,
          status: dto.status || 'draft', // Statut par défaut
        });

        const savedArticle = await this.articleRepository.save(article);
        return savedArticle;
      }),
    );

    return articles;
  }

  /**
   * Supprime tous les articles.
   */
  async deleteAll() {
    return this.articleRepository.deleteAll();
  }

  /**
   * Récupère le nombre total d'articles.
   */
  async getTotal(): Promise<number> {
    return this.articleRepository.getTotalCount();
  }

  /**
   * Enregistre un article en vérifiant si le titre existe déjà.
   */
  async saveWithFilterTitle(
    createArticleDto: CreateArticleDto,
  ): Promise<ArticleEntity | null> {
    try {
      const existingArticle = await this.articleRepository.findOne({
        where: { title: createArticleDto.title },
      });

      if (existingArticle) {
        console.log(`Article avec le titre "${createArticleDto.title}" existe déjà.`);
        return null;
      }

      const newArticle = this.articleRepository.create({
        ...createArticleDto,
        status: createArticleDto.status || 'draft', // Statut par défaut
      });

      return await this.articleRepository.save(newArticle);
    } catch (error) {
      console.error('Erreur lors de l\'enregistrement de l\'article', error);
      throw error;
    }
  }

  /**
   * Enregistre un article.
   */
  async save(createArticleDto: CreateArticleDto): Promise<ArticleEntity> {
    const article = this.articleRepository.create({
      ...createArticleDto,
      status: createArticleDto.status || 'draft', // Statut par défaut
    });

    return this.articleRepository.save(article);
  }

  /**
   * Supprime un article de manière logicielle.
   */
  async softDelete(id: number): Promise<ArticleEntity> {
    await this.findOneById(id); // Vérifie que l'article existe
    return this.articleRepository.softDelete(id); // Effectue la suppression douce
  }

  /**

  async importCSV(file: Express.Multer.File): Promise<ArticleEntity[]> {
    const results: CreateArticleDto[] = [];

    return new Promise((resolve, reject) => {
      const stream = Readable.from(file.buffer);
      stream
        .pipe(csv())
        .on('data', (data) => {
          results.push({
            title: data.title,
            description: data.description,
            category: data.category,
            subCategory: data.subCategory,
            purchasePrice: parseFloat(data.purchasePrice),
            salePrice: parseFloat(data.salePrice),
            quantityInStock: parseInt(data.quantityInStock, 10),
            status: data.status || 'draft', // Statut par défaut
          });
        })
        .on('end', async () => {
          try {
            const importedArticles = await this.saveMany(results);
            resolve(importedArticles);
          } catch (error) {
            reject(new BadRequestException('Erreur lors de l\'enregistrement des articles.'));
          }
        })
        .on('error', (error) => {
          reject(new BadRequestException('Erreur lors de la lecture du fichier CSV.'));
        });
    });
  }

  /**
   * Importe des articles depuis un fichier Excel.
   */
  async importExcel(file: Express.Multer.File): Promise<ArticleEntity[]> {
    const workbook = xlsx.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);

    const articles: CreateArticleDto[] = data.map((row: any) => ({
      title: row.title,
      description: row.description,
      category: row.category,
      subCategory: row.subCategory,
      purchasePrice: parseFloat(row.purchasePrice),
      salePrice: parseFloat(row.salePrice),
      quantityInStock: parseInt(row.quantityInStock, 10),
      status: row.status || 'draft', // Statut par défaut
    }));

    return this.saveMany(articles);
  }

  /**
   * Récupère l'historique des modifications d'un article.
   */
  async getArticleHistory(articleId: number) {
    return this.articleHistoryService.getArticleHistory(articleId);
  }

  /**
   * Met à jour un article.
   */
  async update(
    id: number,
    updateArticleDto: UpdateArticleDto,
  ): Promise<ArticleEntity> {
    // Récupérer l'article existant
    const article = await this.articleRepository.findOneById(id);
  
    if (!article) {
      throw new NotFoundException('Article non trouvé');
    }
  
    // Incrémenter la version
    article.version += 1;
  
    // Enregistrer les modifications dans l'historique
    const changes = this.getChanges(article, updateArticleDto);
    await this.articleHistoryService.createHistoryEntry({
      version: article.version,
      changes,
      articleId: article.id,
    });
  
    // Mettre à jour les champs de l'article
    Object.assign(article, updateArticleDto);
  
    // Sauvegarder les modifications
    return await this.articleRepository.save(article);
  }

  private getChanges(
    existingArticle: ArticleEntity,
    newData: UpdateArticleDto,
  ): Record<string, { oldValue: any; newValue: any }> {
    const changes: Record<string, { oldValue: any; newValue: any }> = {};
  
    // Comparer chaque champ
    Object.keys(newData).forEach((key) => {
      if (existingArticle[key] !== newData[key]) {
        changes[key] = {
          oldValue: existingArticle[key],
          newValue: newData[key],
        };
      }
    });
  
    return changes;
  }

  /**
   * Récupère les performances des ventes d'un article.
   */
  async getSalesPerformance(articleId: number): Promise<{ totalSales: number, totalRevenue: number }> {
    const article = await this.articleRepository.findOneById(articleId);
    if (!article) {
      throw new NotFoundException('Article non trouvé');
    }

    const totalSales = article.quantityInStock || 0;
    const totalRevenue = totalSales * article.salePrice;

    return { totalSales, totalRevenue };
  }

  /**

  async getPopularArticles(limit: number = 10): Promise<ArticleEntity[]> {
    return this.articleRepository.find({
      order: { quantityInStock: 'DESC' },
      take: limit,
    });
  }


  async getStagnantArticles(limit: number = 10): Promise<ArticleEntity[]> {
    return this.articleRepository.find({
      where: { quantityInStock: 0 },
      take: limit,
    });
  }

  /**

  async optimizeStock(articleId: number, newStockLevel: number): Promise<ArticleEntity> {
    const article = await this.articleRepository.findOneById(articleId);
    if (!article) {
      throw new NotFoundException('Article non trouvé');
    }

    article.quantityInStock = newStockLevel;
    return this.articleRepository.save(article);
  }

  /**
   * Ajuste le prix d'un article.
   */
  async adjustPrice(articleId: number, newPrice: number): Promise<ArticleEntity> {
    const article = await this.articleRepository.findOneById(articleId);
    if (!article) {
      throw new NotFoundException('Article non trouvé');
    }

    article.salePrice = newPrice;
    return this.articleRepository.save(article);
  }

  /**
  
  async getStockAlerts(threshold: number = 10): Promise<ArticleEntity[]> {
    return this.articleRepository.find({
      where: { quantityInStock: LessThanOrEqual(threshold) },
    });
  }

  /**

  async getPromotionRecommendations(): Promise<ArticleEntity[]> {
    return this.articleRepository.find({
      where: { quantityInStock: MoreThanOrEqual(50) }, // Exemple de seuil pour les recommandations
    });
  }

  /**
   * Analyse les articles par niveaux.
   */
  async analyzeArticlesByLevels(articleId: number): Promise<{ message: string; data: any }> {
    try {
      const article = await this.articleRepository.findOneById(articleId);
      if (!article) {
        throw new NotFoundException('Article non trouvé.');
      }

      const stockAnalysis = this.analyzeStock([article]); // Analyse du stock
      const salesAnalysis = this.analyzeSales([article]); // Analyse des ventes
      const priceAnalysis = this.analyzePrices([article]); // Analyse des prix
      const categoryAnalysis = this.analyzeByCategory([article]); // Analyse par catégorie
      const trendAnalysis = this.analyzeTrends([article]); // Analyse des tendances

      return {
        message: 'Analyse de l\'article terminée.',
        data: {
          stockAnalysis,
          salesAnalysis,
          priceAnalysis,
          categoryAnalysis,
          trendAnalysis,
        },
      };
    } catch (error) {
      console.error('Erreur lors de l\'analyse de l\'article:', error);
      throw new BadRequestException('Erreur lors de l\'analyse de l\'article.');
    }
  }

  /**
   * Analyse le stock des articles.
   */
  private analyzeStock(articles: ArticleEntity[]): any {
    const lowStock = articles.filter((article) => article.quantityInStock <= 10).length;
    const sufficientStock = articles.filter((article) => article.quantityInStock > 10).length;

    return {
      lowStock,
      sufficientStock,
      totalArticles: articles.length,
    };
  }

  /**
   * Analyse les ventes des articles.
   */
  private analyzeSales(articles: ArticleEntity[]): any {
    const totalSales = articles.reduce((sum, article) => sum + article.quantityInStock, 0);
    const averageSales = totalSales / articles.length || 0;

    const highSales = articles.filter((article) => article.quantityInStock > 50).length;
    const normalSales = articles.filter((article) => article.quantityInStock <= 50).length;

    return {
      totalSales,
      averageSales,
      highSales,
      normalSales,
    };
  }

  /**
   * Analyse les prix des articles.
   */
  private analyzePrices(articles: ArticleEntity[]): any {
    const totalRevenue = articles.reduce((sum, article) => sum + (article.salePrice * article.quantityInStock), 0);
    const averagePrice = totalRevenue / articles.reduce((sum, article) => sum + article.quantityInStock, 0) || 0;

    const premiumArticles = articles.filter((article) => article.salePrice > 100).length;
    const standardArticles = articles.filter((article) => article.salePrice <= 100).length;

    return {
      totalRevenue,
      averagePrice,
      premiumArticles,
      standardArticles,
    };
  }

  /**
   * Analyse les articles par catégorie.
   */
  private analyzeByCategory(articles: ArticleEntity[]): any {
    const categories = {};

    articles.forEach((article) => {
      if (!categories[article.category]) {
        categories[article.category] = {
          count: 0,
          totalSales: 0,
          totalRevenue: 0,
        };
      }

      categories[article.category].count += 1;
      categories[article.category].totalSales += article.quantityInStock;
      categories[article.category].totalRevenue += article.salePrice * article.quantityInStock;
    });

    return categories;
  }

  /**
   * Analyse les tendances des articles.
   */
  private analyzeTrends(articles: ArticleEntity[]): any {
    const trendingArticles = articles
      .filter((article) => article.quantityInStock > 50) // Exemple de critère pour les tendances
      .map((article) => ({
        id: article.id,
        title: article.title,
        sales: article.quantityInStock,
      }));

    return {
      trendingArticles,
      totalTrending: trendingArticles.length,
    };
  }

  async getArticleDetails(id: number): Promise<ResponseArticleDto> {
    try {
      // Récupérer l'article par son ID
      const article = await this.articleRepository.findOneById(id);
  
      if (!article) {
        throw new NotFoundException(`Aucun article trouvé avec l'ID ${id}.`);
      }
  
      // Récupérer l'historique de l'article
      const historyEntries = await this.articleHistoryService.getArticleHistory(id);
  
      // Convertir l'entité en DTO de réponse
      const responseArticleDto: ResponseArticleDto = {
        id: article.id,
        title: article.title,
        description: article.description,
        quantityInStock: article.quantityInStock,
        subCategory: article.subCategory,
        purchasePrice: article.purchasePrice,
        salePrice: article.salePrice,
        category: article.category,
        status: article.status,
        version: article.version,
        createdAt: article.createdAt,
        updatedAt: article.updatedAt,
        deletedAt: article.deletedAt,
        isDeletionRestricted: article.isDeletionRestricted,
        history: historyEntries.map((entry) => ({
          version: entry.version,
          changes: entry.changes,
          date: entry.date,
        })),
      };
  
      return responseArticleDto;
    } catch (error) {
      console.error('Erreur dans getArticleDetails:', error);
      throw new BadRequestException('Erreur lors de la récupération des détails de l\'article.');
    }
  }
}