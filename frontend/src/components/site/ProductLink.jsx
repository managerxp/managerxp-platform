import React from 'react';
import { Link } from 'react-router-dom';

/**
 * A product is either an internal route or an external site. External ones
 * (FlowXP) always open in a new tab and say so to screen readers.
 */
const ProductLink = ({ product, children, ...rest }) =>
  product.external ? (
    <a href={product.href} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  ) : (
    <Link to={product.to} {...rest}>
      {children}
    </Link>
  );

export default ProductLink;
