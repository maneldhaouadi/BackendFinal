/* eslint-disable prettier/prettier */
import { BadRequestException, Injectable } from '@nestjs/common';
import { ArticleExpensQuotationEntryEntity } from '../repositories/entities/article-expensquotation-entry.entity';
import { TaxService } from 'src/modules/tax/services/tax.service';
import { ArticleService } from 'src/modules/article/services/article.service';
import { InvoicingCalculationsService } from 'src/common/calculations/services/invoicing.calculations.service';
import { LineItem } from 'src/common/calculations/interfaces/line-item.interface';
import { IQueryObject } from 'src/common/database/interfaces/database-query-options.interface';
import { QueryBuilder } from 'src/common/database/utils/database-query-builder';
import { EntityManager, FindOneOptions, IsNull, Like, Not } from 'typeorm';
import { ArticleExpensQuotationEntryTaxService } from './article-expensquotation-entry-tax.service';
import { CreateArticleExpensQuotationEntryDto } from '../dtos/article-expensquotation-entry.create.dto';
import { ResponseArticleExpensQuotationEntryDto } from '../dtos/article-expensquotation-entry.response.dto';
import { ExpenseArticleQuotationEntryRepository } from '../repositories/repository/article-expensquotation-entry.repository';
import { ArticleStatus } from 'src/modules/article/interfaces/article-data.interface';
import { ArticleEntity } from 'src/modules/article/repositories/entities/article.entity';
import { ArticleExpensQuotationEntryTaxEntity } from '../repositories/entities/article-expensquotation-entry-tax.entity';

@Injectable()
export class ArticleExpensQuotationEntryService {
    constructor(
        private readonly expensQuotationEntryRepository: ExpenseArticleQuotationEntryRepository,
        private readonly expensQuotationEntryTaxService: ArticleExpensQuotationEntryTaxService,
        private readonly articleService: ArticleService,
        private readonly taxService: TaxService,
        private readonly calculationsService: InvoicingCalculationsService,
        private readonly entityManager:EntityManager
    ) {}

  async saveMany(
        createArticleExpensQuotationEntryDtos: CreateArticleExpensQuotationEntryDto[],
    ): Promise<ArticleExpensQuotationEntryEntity[]> {
        const savedEntries = [];
        for (const dto of createArticleExpensQuotationEntryDtos) {
            const savedEntry = await this.save(dto);
            savedEntries.push(savedEntry);
        }
        return savedEntries;
    }

   async save(
    createArticleExpensQuotationEntryDto: CreateArticleExpensQuotationEntryDto,
): Promise<ArticleExpensQuotationEntryEntity> {
    try {
        // 1. Vérification de la référence
        if (!createArticleExpensQuotationEntryDto.reference) {
            throw new Error('La référence de l\'article est obligatoire');
        }

        // 2. Vérification des doublons dans le devis actuel
        if (createArticleExpensQuotationEntryDto.expenseQuotationId) {
            const existingEntry = await this.expensQuotationEntryRepository.findOne({
                where: {
                    reference: createArticleExpensQuotationEntryDto.reference,
                    expenseQuotationId: createArticleExpensQuotationEntryDto.expenseQuotationId,
                    id: Not(createArticleExpensQuotationEntryDto.id || IsNull())
                }
            });

            if (existingEntry) {
                throw new Error(`Un article avec la référence ${createArticleExpensQuotationEntryDto.reference} existe déjà dans ce devis`);
            }
        }

        // 3. Vérification et récupération des taxes
        const taxes = createArticleExpensQuotationEntryDto.taxes
            ? await Promise.all(
                createArticleExpensQuotationEntryDto.taxes.map(async (id) => {
                    const tax = await this.taxService.findOneById(id);
                    if (!tax) {
                        throw new Error(`Taxe avec l'id ${id} non trouvée`);
                    }
                    return tax;
                }),
              )
            : [];

        // 4. Gestion de l'article
        let article: ArticleEntity | null = null;
        const articleTitle = createArticleExpensQuotationEntryDto.title || createArticleExpensQuotationEntryDto.article?.title;
        const articleDescription = createArticleExpensQuotationEntryDto.description || createArticleExpensQuotationEntryDto.article?.description;

        // CAS 1: Article existant spécifié
        if (createArticleExpensQuotationEntryDto.articleId) {
            article = await this.articleService.findOneById(createArticleExpensQuotationEntryDto.articleId);
            if (!article) {
                throw new Error(`Article avec l'ID ${createArticleExpensQuotationEntryDto.articleId} non trouvé`);
            }

            // Vérification du stock
            const requestedQuantity = createArticleExpensQuotationEntryDto.quantity || 0;
            if (article.quantityInStock < requestedQuantity) {
                throw new Error(`Stock insuffisant pour ${article.reference}. Disponible: ${article.quantityInStock}, Demandé: ${requestedQuantity}`);
            }

            // Mise à jour du stock
            article.quantityInStock -= requestedQuantity;
            
            // Mise à jour du prix si spécifié
            if (createArticleExpensQuotationEntryDto.unit_price !== undefined) {
                article.unitPrice = createArticleExpensQuotationEntryDto.unit_price;
            }

            await this.articleService.update(article.id, {
                quantityInStock: article.quantityInStock,
                unitPrice: article.unitPrice
            });
        }
        // CAS 2: Nouvel article à créer ou article existant par référence
        else {
            // D'abord vérifier si un article avec cette référence existe déjà
            const existingArticle = await this.articleService.findOneByReference(
                createArticleExpensQuotationEntryDto.reference
            );

            if (existingArticle) {
                // Si l'article existe déjà, on l'utilise
                article = existingArticle;

                // Vérification du stock
                const requestedQuantity = createArticleExpensQuotationEntryDto.quantity || 0;
                if (article.quantityInStock < requestedQuantity) {
                    throw new Error(`Stock insuffisant pour ${article.reference}. Disponible: ${article.quantityInStock}, Demandé: ${requestedQuantity}`);
                }

                // Mise à jour du stock
                article.quantityInStock -= requestedQuantity;
                
                // Mise à jour du prix si spécifié
                if (createArticleExpensQuotationEntryDto.unit_price !== undefined) {
                    article.unitPrice = createArticleExpensQuotationEntryDto.unit_price;
                }

                await this.articleService.update(article.id, {
                    quantityInStock: article.quantityInStock,
                    unitPrice: article.unitPrice
                });
            } else {
                // Création d'un nouvel article
                if (!articleTitle) {
                    throw new Error('Le titre de l\'article est obligatoire pour créer un nouvel article');
                }

                article = await this.articleService.save({
                    title: articleTitle,
                    description: articleDescription || '',
                    reference: createArticleExpensQuotationEntryDto.reference,
                    unitPrice: createArticleExpensQuotationEntryDto.unit_price || 0,
                    quantityInStock: createArticleExpensQuotationEntryDto.quantity || 0,
                    status: 'draft'
                });
            }
        }

        // 5. Calcul des totaux
        const lineItem = {
            quantity: createArticleExpensQuotationEntryDto.quantity || 0,
            unit_price: createArticleExpensQuotationEntryDto.unit_price || article.unitPrice || 0,
            discount: createArticleExpensQuotationEntryDto.discount || 0,
            discount_type: createArticleExpensQuotationEntryDto.discount_type,
            taxes
        };

        const subTotal = this.calculationsService.calculateSubTotalForLineItem(lineItem);
        const total = this.calculationsService.calculateTotalForLineItem(lineItem);

        if (isNaN(subTotal) || isNaN(total)) {
            throw new Error('Erreur dans le calcul des totaux');
        }

        // 6. Sauvegarde de l'entrée de devis
        const entryData = {
            ...createArticleExpensQuotationEntryDto,
            reference: article.reference,
            articleId: article.id,
            article: article,
            title: articleTitle,
            description: articleDescription,
            subTotal,
            total,
            originalStock: article.quantityInStock + (createArticleExpensQuotationEntryDto.quantity || 0),
            unit_price: article.unitPrice,
            orderedQuantity: createArticleExpensQuotationEntryDto.quantity
        };

        const entry = await this.expensQuotationEntryRepository.save(entryData);

        // 7. Sauvegarde des taxes associées
        if (taxes.length > 0) {
            await this.expensQuotationEntryTaxService.saveMany(
                taxes.map((tax) => ({
                    taxId: tax.id,
                    expenseArticleEntryId: entry.id,
                })),
            );
        }

        return entry;
    } catch (error) {
        throw new Error(`Erreur lors de la sauvegarde de l'article: ${error.message}`);
    }
}

    async findManyAsLineItem(ids: number[]): Promise<LineItem[]> {
        const lineItems = await Promise.all(
            ids.map((id) => this.findOneAsLineItem(id)),
        );
        return lineItems;
    }

    async findOneAsLineItem(id: number): Promise<LineItem> {
        const entry = await this.findOneByCondition({
            filter: `id||$eq||${id}`,
            join: 'articleExpensQuotationEntryTaxes',
        });
        
        if (!entry) {
            throw new Error(`Article quotation entry with ID ${id} not found`);
        }
    
        // Ensure taxes are loaded
        const taxes = entry.articleExpensQuotationEntryTaxes
            ? await Promise.all(
                entry.articleExpensQuotationEntryTaxes.map(async (taxEntry) => {
                    try {
                        return await this.taxService.findOneById(taxEntry.taxId);
                    } catch (error) {
                        console.error(`Error loading tax with ID ${taxEntry.taxId}:`, error);
                        return null;
                    }
                }).filter(tax => tax !== null)
              )
            : [];
        
        return {
            quantity: entry.quantity,
            unit_price: entry.unit_price,
            discount: entry.discount,
            discount_type: entry.discount_type,
            taxes: taxes.filter(Boolean), // Remove any null values
        };
    }

    async findOneByCondition(
        query: IQueryObject,
    ): Promise<ArticleExpensQuotationEntryEntity | null> {  // Changed return type to Entity
        const queryBuilder = new QueryBuilder();
        const queryOptions = queryBuilder.build(query);
        return this.expensQuotationEntryRepository.findOne(
            queryOptions as FindOneOptions<ArticleExpensQuotationEntryEntity>,
        );
    }

    async update(
        id: number,
        updateDto: Partial<CreateArticleExpensQuotationEntryDto>,
    ): Promise<ArticleExpensQuotationEntryEntity> {
        return this.entityManager.transaction(async (transactionalEntityManager) => {
            // 1. Récupérer l'entrée existante avec ses relations
            const existingEntry = await transactionalEntityManager.findOne(
                ArticleExpensQuotationEntryEntity,
                {
                    where: { id },
                    relations: ['articleExpensQuotationEntryTaxes', 'article'],
                    lock: { mode: "pessimistic_write" }
                }
            );
    
            if (!existingEntry) {
                throw new Error(`Article quotation entry with ID ${id} not found`);
            }
    
            // 2. Mise à jour complète de l'article associé s'il existe
            let article = existingEntry.article;
            if (article) {
                // Préparation des données de mise à jour - AJOUT DES CHAMPS TITLE ET DESCRIPTION
                const articleUpdateData = {
                    title: updateDto.article?.title ?? article.title, // Prend le titre du DTO ou conserve l'ancien
                    description: updateDto.article?.description ?? article.description, // Prend la description du DTO ou conserve l'ancienne
                    reference: updateDto.reference ?? article.reference,
                    unitPrice: updateDto.unit_price ?? article.unitPrice,
                    // quantityInStock sera mis à jour après calcul
                };
    
                // Calcul de la différence de quantité
                const oldQuantity = existingEntry.quantity;
                const newQuantity = updateDto.quantity ?? oldQuantity;
                const quantityDifference = newQuantity - oldQuantity;
                const newStock = article.quantityInStock - quantityDifference;
    
                if (newStock < 0) {
                    throw new BadRequestException(
                        `Stock insuffisant. Disponible: ${article.quantityInStock}, Demandé: ${newQuantity}`
                    );
                }
    
                // Mise à jour complète de l'article
                await transactionalEntityManager.update(
                    ArticleEntity,
                    article.id,
                    {
                        ...articleUpdateData,
                        quantityInStock: newStock
                    }
                );
    
                // Recharger l'article pour avoir les dernières données
                article = await transactionalEntityManager.findOne(
                    ArticleEntity, 
                    { where: { id: article.id } }
                );
            }
    
            // 3. Mise à jour des taxes
            if (updateDto.taxes) {
                // Supprimer les anciennes taxes
                await transactionalEntityManager.delete(
                    ArticleExpensQuotationEntryTaxEntity,
                    { expenseArticleEntryId: id }
                );
    
                // Ajouter les nouvelles taxes
                await this.expensQuotationEntryTaxService.saveMany(
                    updateDto.taxes.map(taxId => ({
                        taxId,
                        expenseArticleEntryId: id
                    })),
                );
            }
    
            // 4. Calcul des nouveaux totaux
            const taxes = updateDto.taxes 
                ? await Promise.all(updateDto.taxes.map(id => this.taxService.findOneById(id)))
                : existingEntry.articleExpensQuotationEntryTaxes?.map(tax => tax.tax) || [];
    
            const lineItem = {
                quantity: updateDto.quantity ?? existingEntry.quantity,
                unit_price: updateDto.unit_price ?? existingEntry.unit_price,
                discount: updateDto.discount ?? existingEntry.discount,
                discount_type: updateDto.discount_type ?? existingEntry.discount_type,
                taxes
            };
    
            const subTotal = this.calculationsService.calculateSubTotalForLineItem(lineItem);
            const total = this.calculationsService.calculateTotalForLineItem(lineItem);
    
            // 5. Mise à jour de l'entrée de devis
            const updatedEntry = await transactionalEntityManager.save(
                ArticleExpensQuotationEntryEntity,
                {
                    ...existingEntry,
                    ...updateDto,
                    articleId: article?.id,
                    article,
                    subTotal,
                    total,
                    originalStock: article ? article.quantityInStock + (updateDto.quantity ?? existingEntry.quantity) : null
                }
            );
    
            return updatedEntry;
        });
    }

    async duplicate(
        id: number,
        newExpensQuotationId: number, // Renommé pour plus de clarté
      ): Promise<ArticleExpensQuotationEntryEntity> {
        const existingEntry = await this.findOneByCondition({
          filter: `id||$eq||${id}`,
          join: 'articleExpensQuotationEntryTaxes',
        });
      
        if (!existingEntry) {
          throw new Error('Entry not found');
        }
      
        // Générer nouvelle référence basée sur le NOUVEAU devis
        const newReference = await this.generateSequentialReference(newExpensQuotationId);
      
        const duplicatedEntry = {
          ...existingEntry,
          reference: newReference, // Cette référence sera nouvelle
          expenseQuotationId: newExpensQuotationId,
          id: undefined,
          createdAt: undefined,
          updatedAt: undefined,
          articleExpensQuotationEntryTaxes: existingEntry.articleExpensQuotationEntryTaxes?.map(
            tax => ({ taxId: tax.taxId })
          ) || []
        };
      
        const newEntry = await this.expensQuotationEntryRepository.save(duplicatedEntry);
      
        if (duplicatedEntry.articleExpensQuotationEntryTaxes.length > 0) {
          await this.expensQuotationEntryTaxService.saveMany(
            duplicatedEntry.articleExpensQuotationEntryTaxes.map(tax => ({
              taxId: tax.taxId,
              expenseArticleEntryId: newEntry.id
            }))
          );
        }
      
        return newEntry;
      }
    
    private async generateSequentialReference(quotationId: number): Promise<string> {
        // Get the last reference used in this quotation
        const lastEntry = await this.expensQuotationEntryRepository.findOne({
            where: { expenseQuotationId: quotationId },
            order: { id: 'DESC' },
            select: ['reference']
        });
    
        if (!lastEntry) {
            // First entry in this quotation
            return `REF-${quotationId}-001`;
        }
    
        // Extract the numeric part and increment
        const matches = lastEntry.reference.match(/(.*-)(\d+)$/);
        if (matches && matches[2]) {
            const prefix = matches[1];
            const number = parseInt(matches[2], 10) + 1;
            return `${prefix}${number.toString().padStart(3, '0')}`;
        }
    
        // Fallback if pattern doesn't match
        return `REF-${quotationId}-${Date.now()}`;
    }

    async duplicateMany(
        entryIds: number[],
        newQuotationId: number
    ): Promise<ArticleExpensQuotationEntryEntity[]> {
        const duplicatedEntries: ArticleExpensQuotationEntryEntity[] = [];
        
        for (const entryId of entryIds) {
            const duplicatedEntry = await this.duplicate(entryId, newQuotationId);
            duplicatedEntries.push(duplicatedEntry);
        }
        
        return duplicatedEntries;
    }


    async softDelete(id: number): Promise<ArticleExpensQuotationEntryEntity> {
        const entry = await this.expensQuotationEntryRepository.findByCondition({
          where: { id, deletedAt: null },
          relations: { articleExpensQuotationEntryTaxes: true },
        });
        await this.expensQuotationEntryTaxService.softDeleteMany(
          entry.articleExpensQuotationEntryTaxes.map((taxEntry) => taxEntry.id),
        );
        return this.expensQuotationEntryRepository.softDelete(id);
      }
    
      async softDeleteMany(ids: number[]): Promise<ArticleExpensQuotationEntryEntity[]> {
        const entries = await Promise.all(
          ids.map(async (id) => this.softDelete(id)),
        );
        return entries;
      }


}


