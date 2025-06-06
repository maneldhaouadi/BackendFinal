CREATE TABLE IF NOT EXISTS `template` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `content` TEXT NOT NULL,
    `type` ENUM('invoice', 'quotation', 'payment') NOT NULL,
    `isDefault` BOOLEAN DEFAULT FALSE,
    `sequentialNumber` VARCHAR(25) DEFAULT NULL,
    `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deletedAt` TIMESTAMP NULL DEFAULT NULL,
    `isDeletionRestricted` BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;